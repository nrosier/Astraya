/**
 * The first-admin bootstrap flow (`server/auth/bootstrap.ts`), tested directly
 * against its exported functions rather than through HTTP — the token itself
 * is only ever visible via the log line, so these tests capture that line and
 * parse it out, exactly as an operator reading the container logs would.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import { openDatabase, type Database } from '../server/db.ts';
import { adminExists, announceBootstrap, checkBootstrapToken } from '../server/auth/bootstrap.ts';

function fakeLogger(): { warn: (message: string) => void; messages: string[] } {
  const messages: string[] = [];
  return { warn: (message: string) => messages.push(message), messages };
}

/** Pulls the token out of the one log line `announceBootstrap` writes, given the accumulated log messages. */
function extractToken(messages: readonly string[]): string {
  const message = messages[0];
  if (message === undefined) throw new Error('announceBootstrap did not log anything.');
  const match = /token=(\S+)/.exec(message);
  if (!match?.[1]) throw new Error(`No bootstrap token found in log line: ${message}`);
  return match[1];
}

function createAdmin(db: Database): void {
  db.prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, 1, ?)').run(
    'admin-id',
    'admin',
    'hash',
    new Date().toISOString(),
  );
}

describe('server/auth/bootstrap.ts', () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
    delete process.env.ASTRAYA_BOOTSTRAP_TOKEN;
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
    delete process.env.ASTRAYA_BOOTSTRAP_TOKEN;
  });

  it('reports no admin for a fresh database', () => {
    expect(adminExists(db)).toBe(false);
  });

  it('generates a random token and logs the bootstrap URL', () => {
    const log = fakeLogger();
    announceBootstrap(db, log as unknown as FastifyBaseLogger);
    expect(log.messages).toHaveLength(1);
    // Hash-routed (`/#/setup?...`), not a plain path (`/setup?...`) — the app is a hash-router
    // SPA (src/ui/route.ts) and a plain path never reaches any route.
    expect(log.messages[0]).toContain('/#/setup?token=');

    const token = extractToken(log.messages);
    expect(checkBootstrapToken(token)).toBeNull();
    expect(checkBootstrapToken('not-the-token')).toBe('invalid');
  });

  it('compares the token without short-circuiting on length or first byte (#330)', () => {
    // `timingSafeEqual` throws on unequal lengths, and the expected token's length is
    // itself a secret when it comes from `ASTRAYA_BOOTSTRAP_TOKEN` — so both sides are
    // hashed to a fixed width first. These cases are the ones a naive implementation of
    // that would throw on rather than reject.
    const log = fakeLogger();
    announceBootstrap(db, log as unknown as FastifyBaseLogger);
    const token = extractToken(log.messages);

    expect(checkBootstrapToken('')).toBe('invalid');
    expect(checkBootstrapToken('x')).toBe('invalid');
    expect(checkBootstrapToken(`${token}x`)).toBe('invalid');
    expect(checkBootstrapToken(token.slice(0, -1))).toBe('invalid');
    // Differing in the first byte and in the last must both be refused, and neither may
    // throw — the whole token is still compared either way.
    expect(checkBootstrapToken(`Z${token.slice(1)}`)).toBe('invalid');
    expect(checkBootstrapToken(`${token.slice(0, -1)}Z`)).toBe('invalid');
    expect(checkBootstrapToken(token)).toBeNull();
  });

  it('logs again on every call while still un-bootstrapped, not just the first', () => {
    const log = fakeLogger();
    announceBootstrap(db, log as unknown as FastifyBaseLogger);
    announceBootstrap(db, log as unknown as FastifyBaseLogger);
    expect(log.messages).toHaveLength(2);
  });

  it('expires the token 15 minutes after it was issued', () => {
    vi.useFakeTimers();
    const log = fakeLogger();
    announceBootstrap(db, log as unknown as FastifyBaseLogger);
    const token = extractToken(log.messages);
    expect(checkBootstrapToken(token)).toBeNull();

    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(checkBootstrapToken(token)).toBe('expired');
  });

  it('prefers ASTRAYA_BOOTSTRAP_TOKEN when set, and that token does not expire on its own', () => {
    process.env.ASTRAYA_BOOTSTRAP_TOKEN = 'env-supplied-token';
    vi.useFakeTimers();
    const log = fakeLogger();
    announceBootstrap(db, log as unknown as FastifyBaseLogger);
    expect(checkBootstrapToken('env-supplied-token')).toBeNull();

    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000);
    expect(checkBootstrapToken('env-supplied-token')).toBeNull();
  });

  it('is single-use in effect: once an admin exists, the previously-issued token stops working', () => {
    const log = fakeLogger();
    announceBootstrap(db, log as unknown as FastifyBaseLogger);
    const token = extractToken(log.messages);

    createAdmin(db);
    // Mirrors routes.ts: the setup route re-announces immediately after creating
    // the admin, which is what actually clears the in-memory token.
    announceBootstrap(db, log as unknown as FastifyBaseLogger);

    expect(adminExists(db)).toBe(true);
    expect(checkBootstrapToken(token)).toBe('no-token-issued');
  });

  it('reports no-token-issued when nothing has called announceBootstrap for this state', () => {
    createAdmin(db);
    const log = fakeLogger();
    announceBootstrap(db, log as unknown as FastifyBaseLogger);
    expect(log.messages).toHaveLength(0);
    expect(checkBootstrapToken('anything')).toBe('no-token-issued');
  });
});
