/**
 * `server/auth/sessions.ts` in isolation, against a real in-memory schema —
 * closes a gap in #85's checklist: nothing exercised `touchSession`'s sliding
 * expiry or the shorter OIDC TTL directly before this file existed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../server/db.ts';
import {
  createSession,
  getSession,
  revokeAllSessionsForUser,
  revokeSession,
  touchSession,
} from '../server/auth/sessions.ts';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OIDC_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

let db: DatabaseSync;
let userId: string;

function insertUser(): string {
  const id = randomUUID();
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    `user-${id}`,
    'hash',
    new Date().toISOString(),
  );
  return id;
}

beforeEach(() => {
  db = openDatabase(':memory:');
  userId = insertUser();
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
});

describe('createSession', () => {
  it('creates a local-account session with the 30-day sliding TTL', () => {
    const before = Date.now();
    const session = createSession(db, userId);
    expect(session.userId).toBe(userId);
    expect(session.oidcIdToken).toBeNull();
    expect(new Date(session.expiresAt).getTime()).toBeCloseTo(before + SESSION_TTL_MS, -2);
  });

  it('creates an OIDC-derived session with the shorter 24h sliding TTL', () => {
    const before = Date.now();
    const session = createSession(db, userId, { oidcIdToken: 'raw-id-token' });
    expect(session.oidcIdToken).toBe('raw-id-token');
    expect(new Date(session.expiresAt).getTime()).toBeCloseTo(before + OIDC_SESSION_TTL_MS, -2);
  });
});

describe('getSession', () => {
  it('returns the session when it exists and has not expired', () => {
    const created = createSession(db, userId);
    const found = getSession(db, created.id);
    expect(found).toEqual(created);
  });

  it('returns null for an unknown session id', () => {
    expect(getSession(db, randomUUID())).toBeNull();
  });

  it('returns null once the session has expired, without deleting the row', () => {
    const created = createSession(db, userId);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + SESSION_TTL_MS + 1000);
    expect(getSession(db, created.id)).toBeNull();

    vi.useRealTimers();
    const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(created.id);
    expect(row).toBeTruthy();
  });
});

describe('touchSession', () => {
  it('extends a local-account session forward by the 30-day TTL from now', () => {
    const created = createSession(db, userId);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 1000);
    const now = Date.now();
    touchSession(db, created.id);
    vi.useRealTimers();

    const row = db.prepare('SELECT expires_at, last_seen_at FROM sessions WHERE id = ?').get(created.id) as {
      expires_at: string;
      last_seen_at: string;
    };
    expect(new Date(row.expires_at).getTime()).toBeCloseTo(now + SESSION_TTL_MS, -2);
    expect(new Date(row.last_seen_at).getTime()).toBeCloseTo(now, -2);
  });

  it('extends an OIDC-derived session forward by the shorter 24h TTL, not the 30-day one', () => {
    const created = createSession(db, userId, { oidcIdToken: 'raw-id-token' });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 1000);
    const now = Date.now();
    touchSession(db, created.id);
    vi.useRealTimers();

    const row = db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(created.id) as {
      expires_at: string;
    };
    expect(new Date(row.expires_at).getTime()).toBeCloseTo(now + OIDC_SESSION_TTL_MS, -2);
  });

  it('is a no-op for an unknown session id', () => {
    expect(() => {
      touchSession(db, randomUUID());
    }).not.toThrow();
  });
});

describe('revokeSession', () => {
  it('deletes the session row so a subsequent getSession returns null', () => {
    const created = createSession(db, userId);
    revokeSession(db, created.id);
    expect(getSession(db, created.id)).toBeNull();
    expect(db.prepare('SELECT id FROM sessions WHERE id = ?').get(created.id)).toBeUndefined();
  });
});

describe('revokeAllSessionsForUser', () => {
  it('deletes every session for that user, and no others', () => {
    const otherUserId = insertUser();
    const mine1 = createSession(db, userId);
    const mine2 = createSession(db, userId);
    const other = createSession(db, otherUserId);

    revokeAllSessionsForUser(db, userId);

    expect(getSession(db, mine1.id)).toBeNull();
    expect(getSession(db, mine2.id)).toBeNull();
    expect(getSession(db, other.id)).not.toBeNull();
  });
});
