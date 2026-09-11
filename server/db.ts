/**
 * The sync server's database: `users`, `sessions`, `ops`.
 *
 * Per ADR 0002 the server is an opaque relay — it stores operations, never the
 * domain model they encode. `people` and `charts` are not tables here; they exist
 * only inside `ops.payload`. That is what lets a new domain field ship as a client
 * release with no migration and no server deploy. `users` and `sessions` *are*
 * server tables because the server, not the browser, owns credentials.
 *
 * `node:sqlite` rather than `better-sqlite3`: a native module has to compile per
 * architecture, which complicates the arm64 build. `node:sqlite` ships with Node.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Database = DatabaseSync;

/**
 * Each step takes the schema from version n-1 to n. Kept as an ordered list so the
 * history is data, not something a fresh database happens to match by accident —
 * a fresh open and an upgraded one run the exact same steps.
 */
const MIGRATIONS: readonly ((db: DatabaseSync) => void)[] = [
  // 1: users, sessions, and the opaque operation log.
  (db) => {
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        disabled_at TEXT
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX sessions_user_id ON sessions(user_id);

      -- key_version/iv stay nullable so #92 (at-rest encryption) and #108 (optional
      -- end-to-end encryption) can land with no migration. Null means plaintext.
      CREATE TABLE ops (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        hlc TEXT NOT NULL,
        device_id TEXT NOT NULL,
        op_version INTEGER NOT NULL,
        payload BLOB NOT NULL,
        key_version INTEGER,
        iv BLOB,
        received_at TEXT NOT NULL
      );
      -- Unique so a retried push is idempotent; an HLC is globally unique by
      -- construction, so this costs nothing on the write path.
      CREATE UNIQUE INDEX ops_user_hlc ON ops(user_id, hlc);
      CREATE INDEX ops_user_seq ON ops(user_id, seq);
    `);
  },
];

interface UserVersionRow {
  readonly user_version: number;
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as unknown as UserVersionRow;
  for (let version = row.user_version + 1; version <= MIGRATIONS.length; version++) {
    const step = MIGRATIONS[version - 1];
    if (!step) throw new Error(`No migration registered for schema version ${version}`);
    db.exec('BEGIN');
    try {
      step(db);
      // Not a bound parameter: PRAGMA doesn't accept one, and `version` is this
      // module's own loop counter, never external input.
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

/**
 * Opens (creating if needed) the database at `path` and runs pending migrations.
 * Safe to call on every process start.
 *
 * `path` may be `:memory:` for tests. WAL mode is skipped there — SQLite ignores
 * it for in-memory databases anyway — and is otherwise required: the database
 * lives on a mounted volume, and WAL's `-wal`/`-shm` siblings need that directory,
 * not merely the file, to be writable.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  return db;
}
