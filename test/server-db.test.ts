/**
 * `server/db.ts`'s migration runner. The property that matters most: a fresh
 * database and one migrated step-by-step end up with the identical schema —
 * `PRAGMA user_version` is the only thing that says how far along a database
 * is, so nothing here should special-case "fresh" vs. "upgraded".
 */
import { describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
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
    expect(row.user_version).toBe(1);
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
      expect(row.user_version).toBe(1);
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
});
