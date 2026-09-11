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
  // 2: OIDC identity columns (#75). Plain `ALTER TABLE ADD COLUMN` — no rebuild,
  // no foreign-key hazard. A NULL/NULL pair never collides in a UNIQUE index, so
  // every existing local-only row is unaffected.
  (db) => {
    db.exec(`
      ALTER TABLE users ADD COLUMN oidc_issuer TEXT;
      ALTER TABLE users ADD COLUMN oidc_subject TEXT;
      CREATE UNIQUE INDEX users_oidc_identity ON users(oidc_issuer, oidc_subject);
    `);
  },
  // 3: `password_hash` becomes nullable (an OIDC-only account has no password),
  // and sessions gain the OIDC id token they were minted from (#77). SQLite has
  // no ALTER COLUMN, so this rebuilds `users` — but under a *temporary* name,
  // dropping the *original* and renaming the temp table back, rather than
  // renaming the original away — otherwise `sessions`/`ops`'s
  // `REFERENCES users(id)` clauses would keep pointing at a name that no longer
  // exists. See `migrate()`'s foreign-key handling around this step.
  (db) => {
    db.exec(`
      CREATE TABLE users_new (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        disabled_at TEXT,
        oidc_issuer TEXT,
        oidc_subject TEXT
      );
      INSERT INTO users_new (id, username, password_hash, is_admin, created_at, disabled_at, oidc_issuer, oidc_subject)
        SELECT id, username, password_hash, is_admin, created_at, disabled_at, oidc_issuer, oidc_subject FROM users;
      -- Dropping users drops its users_oidc_identity index along with it, so
      -- the name is free to reuse on users_new below, before the rename.
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
      CREATE UNIQUE INDEX users_oidc_identity ON users(oidc_issuer, oidc_subject);

      ALTER TABLE sessions ADD COLUMN oidc_id_token TEXT;
    `);
  },
  // 4: a durable, admin-issued, single-use link for both "create a local
  // account" and "reset a password" (#135) — a plain ALTER TABLE ADD COLUMN,
  // no rebuild. A NULL token never collides with another NULL in the unique
  // index, same reasoning as users_oidc_identity above.
  (db) => {
    db.exec(`
      ALTER TABLE users ADD COLUMN password_set_token TEXT;
      ALTER TABLE users ADD COLUMN password_set_token_expires_at TEXT;
      CREATE UNIQUE INDEX users_password_set_token ON users(password_set_token);
    `);
  },
];

/** Migration steps whose table rebuild would otherwise break `REFERENCES` clauses pointing at the table being rebuilt. */
const REQUIRES_FOREIGN_KEYS_OFF = new Set<number>([3]);

interface UserVersionRow {
  readonly user_version: number;
}

interface ForeignKeyViolation {
  readonly table: string;
}

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as unknown as UserVersionRow;
  for (let version = row.user_version + 1; version <= MIGRATIONS.length; version++) {
    const step = MIGRATIONS[version - 1];
    if (!step) throw new Error(`No migration registered for schema version ${version}`);
    // SQLite no-ops this pragma inside an active transaction, so a step that
    // rebuilds a referenced table must have it turned off *before* BEGIN and
    // back on *after* COMMIT (or ROLLBACK) — never inside the transaction itself.
    const toggleForeignKeys = REQUIRES_FOREIGN_KEYS_OFF.has(version);
    if (toggleForeignKeys) db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      step(db);
      if (toggleForeignKeys) {
        // Fails loudly rather than committing a rebuild that quietly orphaned a
        // row — same "never silently wrong" precedent as the GCM auth-tag check
        // in `server/ops/crypto.ts`.
        const violations = db.prepare('PRAGMA foreign_key_check').all() as unknown as ForeignKeyViolation[];
        if (violations.length > 0) {
          throw new Error(
            `Migration to schema version ${version} left foreign-key violations in: ${violations.map((v) => v.table).join(', ')}`,
          );
        }
      }
      // Not a bound parameter: PRAGMA doesn't accept one, and `version` is this
      // module's own loop counter, never external input.
      db.exec(`PRAGMA user_version = ${version}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      if (toggleForeignKeys) db.exec('PRAGMA foreign_keys = ON');
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
