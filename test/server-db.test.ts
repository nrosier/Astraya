/**
 * `server/db.ts`'s migration runner. The property that matters most: a fresh
 * database and one migrated step-by-step end up with the identical schema —
 * `PRAGMA user_version` is the only thing that says how far along a database
 * is, so nothing here should special-case "fresh" vs. "upgraded".
 */
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.ts';

interface SchemaRow {
  readonly type: string;
  readonly name: string;
  readonly sql: string | null;
}

function schemaOf(db: DatabaseSync): SchemaRow[] {
  return db
    .prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index') ORDER BY name")
    .all() as unknown as SchemaRow[];
}

describe('server/db.ts', () => {
  it('creates the users, sessions and ops tables', () => {
    const db = openDatabase(':memory:');
    const names = schemaOf(db).map((row) => row.name);
    expect(names).toContain('users');
    expect(names).toContain('sessions');
    expect(names).toContain('ops');
    db.close();
  });

  it('sets PRAGMA user_version to the number of migrations applied', () => {
    const db = openDatabase(':memory:');
    const row = db.prepare('PRAGMA user_version').get() as unknown as { user_version: number };
    expect(row.user_version).toBe(3);
    db.close();
  });

  it('is idempotent: reopening an already-migrated file runs no migration twice', () => {
    const dir = mkdtempSync(join(tmpdir(), 'astraya-db-test-'));
    const path = join(dir, 'astraya.db');
    try {
      const first = openDatabase(path);
      const before = schemaOf(first);
      first.close();

      // Simulates a process restart against the same file: migrations already
      // applied must not run again (and would fail loudly if they tried, since
      // e.g. `CREATE TABLE users` would collide with the existing one).
      const second = openDatabase(path);
      expect(schemaOf(second)).toEqual(before);
      const row = second.prepare('PRAGMA user_version').get() as unknown as { user_version: number };
      expect(row.user_version).toBe(3);
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a fresh database and a step-by-step migrated one produce the identical schema', () => {
    const fresh = openDatabase(':memory:');
    const freshSchema = schemaOf(fresh);
    fresh.close();

    const dir = mkdtempSync(join(tmpdir(), 'astraya-db-test-'));
    const path = join(dir, 'astraya.db');
    try {
      const stepped = openDatabase(path);
      expect(schemaOf(stepped)).toEqual(freshSchema);
      stepped.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /** Exactly migration 1's DDL (`server/db.ts`), frozen here so this test always starts from the
   * schema real deployments upgraded from — not from whatever `server/db.ts` currently defines. */
  function createV1Database(path: string): void {
    const db = new DatabaseSync(path);
    db.exec(`
      PRAGMA foreign_keys = ON;
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
      CREATE UNIQUE INDEX ops_user_hlc ON ops(user_id, hlc);
      CREATE INDEX ops_user_seq ON ops(user_id, seq);
      PRAGMA user_version = 1;
    `);
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
      'legacy-user',
      'legacy',
      'legacy-hash',
      new Date().toISOString(),
    );
    db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(
      'legacy-session',
      'legacy-user',
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    db.prepare(
      'INSERT INTO ops (user_id, hlc, device_id, op_version, payload, received_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('legacy-user', 'hlc-legacy', 'device-1', 1, Buffer.from('payload'), new Date().toISOString());
    db.close();
  }

  it('upgrades a real v1 database with existing data, without breaking foreign keys or new inserts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'astraya-db-test-'));
    const path = join(dir, 'astraya.db');
    try {
      createV1Database(path);

      const db = openDatabase(path);
      const row = db.prepare('PRAGMA user_version').get() as unknown as { user_version: number };
      expect(row.user_version).toBe(3);

      // The pre-existing row survived the users rebuild intact.
      const legacyUser = db.prepare('SELECT * FROM users WHERE id = ?').get('legacy-user') as
        { password_hash: string; oidc_issuer: string | null } | undefined;
      expect(legacyUser?.password_hash).toBe('legacy-hash');
      expect(legacyUser?.oidc_issuer).toBeNull();

      // A plain login-flow insert into sessions (referencing the rebuilt users table by name)
      // still succeeds — this is the exact failure mode the naive rebuild pattern produces.
      expect(() =>
        db
          .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
          .run(
            'new-session',
            'legacy-user',
            new Date().toISOString(),
            new Date().toISOString(),
            new Date().toISOString(),
          ),
      ).not.toThrow();

      // Cascading delete still works post-rebuild.
      db.prepare('DELETE FROM users WHERE id = ?').run('legacy-user');
      const sessions = db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number };
      const ops = db.prepare('SELECT COUNT(*) AS count FROM ops').get() as { count: number };
      expect(sessions.count).toBe(0);
      expect(ops.count).toBe(0);

      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('enforces foreign keys with cascading delete from users to sessions and ops', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
      'u1',
      'alice',
      'hash',
      new Date().toISOString(),
    );
    db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)').run(
      's1',
      'u1',
      new Date().toISOString(),
      new Date().toISOString(),
      new Date().toISOString(),
    );
    db.prepare(
      'INSERT INTO ops (user_id, hlc, device_id, op_version, payload, received_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('u1', 'hlc-1', 'device-1', 1, Buffer.from('payload'), new Date().toISOString());

    db.prepare('DELETE FROM users WHERE id = ?').run('u1');

    const sessions = db.prepare('SELECT COUNT(*) AS count FROM sessions').get() as { count: number };
    const ops = db.prepare('SELECT COUNT(*) AS count FROM ops').get() as { count: number };
    expect(sessions.count).toBe(0);
    expect(ops.count).toBe(0);
    db.close();
  });

  it('rejects a second op with the same (user_id, hlc)', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
      'u1',
      'alice',
      'hash',
      new Date().toISOString(),
    );
    const insertOp = () =>
      db
        .prepare(
          'INSERT INTO ops (user_id, hlc, device_id, op_version, payload, received_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run('u1', 'hlc-1', 'device-1', 1, Buffer.from('payload'), new Date().toISOString());
    insertOp();
    expect(insertOp).toThrow();
    db.close();
  });

  it('rejects a duplicate username regardless of case', () => {
    const db = openDatabase(':memory:');
    const insertUser = (id: string, username: string) =>
      db
        .prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(id, username, 'hash', new Date().toISOString());
    insertUser('u1', 'alice');
    expect(() => insertUser('u2', 'ALICE')).toThrow();
    db.close();
  });

  it('allows a password-only user and an OIDC-only user (NULL password_hash) side by side', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
      'u1',
      'alice',
      'hash',
      new Date().toISOString(),
    );
    expect(() =>
      db
        .prepare(
          'INSERT INTO users (id, username, password_hash, created_at, oidc_issuer, oidc_subject) VALUES (?, ?, NULL, ?, ?, ?)',
        )
        .run('u2', 'bob', new Date().toISOString(), 'https://issuer.example', 'sub-1'),
    ).not.toThrow();
    db.close();
  });

  it('rejects a second user with the same (oidc_issuer, oidc_subject) but allows many with neither set', () => {
    const db = openDatabase(':memory:');
    const insertOidcUser = (id: string, username: string) =>
      db
        .prepare(
          'INSERT INTO users (id, username, password_hash, created_at, oidc_issuer, oidc_subject) VALUES (?, ?, NULL, ?, ?, ?)',
        )
        .run(id, username, new Date().toISOString(), 'https://issuer.example', 'sub-1');
    insertOidcUser('u1', 'alice');
    expect(() => insertOidcUser('u2', 'bob')).toThrow();

    // Two local-only accounts (oidc_issuer/oidc_subject both NULL) never collide.
    const insertLocalUser = (id: string, username: string) =>
      db
        .prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(id, username, 'hash', new Date().toISOString());
    expect(() => insertLocalUser('u3', 'carol')).not.toThrow();
    expect(() => insertLocalUser('u4', 'dave')).not.toThrow();
    db.close();
  });
});
