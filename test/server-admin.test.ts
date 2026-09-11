/**
 * Admin user management (`server/auth/admin-routes.ts`, #135), exercised through
 * Fastify's `app.inject()` against a temp SQLite file — same shape as
 * `test/server-ops.test.ts`, which this borrows its admin/second-user setup
 * helpers from.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { build } from '../server/index.ts';
import { hashPassword } from '../server/auth/passwords.ts';
import { createClock, randomNodeId, tick } from '../src/store/hlc.ts';

const BOOTSTRAP_TOKEN = 'test-bootstrap-token';
const SESSION_COOKIE = 'astraya_session';
const ENCRYPTION_KEY = randomBytes(32).toString('base64');

process.env.LOG_LEVEL = 'silent';

let dir: string;
let dbPath: string;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-admin-test-'));
  dbPath = join(dir, 'astraya.db');
  process.env.ASTRAYA_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
  process.env.ASTRAYA_ENCRYPTION_KEY = ENCRYPTION_KEY;
  app = await build({ dbPath });
});

afterEach(async () => {
  await app.close();
  delete process.env.ASTRAYA_BOOTSTRAP_TOKEN;
  delete process.env.ASTRAYA_ENCRYPTION_KEY;
  delete process.env.ASTRAYA_OIDC_ISSUER;
  delete process.env.ASTRAYA_OIDC_CLIENT_ID;
  delete process.env.ASTRAYA_PUBLIC_URL;
  rmSync(dir, { recursive: true, force: true });
});

async function setupAdmin(target: FastifyInstance, username = 'alice', password = 'correct-horse-battery') {
  const response = await target.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { token: BOOTSTRAP_TOKEN, username, password },
  });
  const sessionId = response.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
  if (!sessionId) throw new Error('setup did not set a session cookie');
  return sessionId;
}

async function createAndLoginUser(
  target: FastifyInstance,
  username: string,
  password: string,
  targetDbPath: string = dbPath,
): Promise<string> {
  const passwordHash = await hashPassword(password);
  const raw = new DatabaseSync(targetDbPath);
  raw
    .prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(randomUUID(), username, passwordHash, new Date().toISOString());
  raw.close();

  const login = await target.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  const sessionId = login.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
  if (!sessionId) throw new Error('login did not set a session cookie');
  return sessionId;
}

/** `setPasswordUrl` is a hash-route URL (`/#/set-password?token=...`) — the query lives in the fragment, not `URL.search`. */
function extractSetPasswordToken(setPasswordUrl: string): string | null {
  const hash = setPasswordUrl.split('#')[1] ?? '';
  const queryIndex = hash.indexOf('?');
  if (queryIndex === -1) return null;
  return new URLSearchParams(hash.slice(queryIndex + 1)).get('token');
}

interface ClockRef {
  current: ReturnType<typeof createClock>;
}

/** Pushes one fixture op through the real relay, matching the client's wire mapping (Phase 3). */
async function pushOp(
  target: FastifyInstance,
  sessionCookie: string,
  clockRef: ClockRef,
  body: { readonly entity: string; readonly entityId: string; readonly field: string; readonly value: unknown },
) {
  const { clock, hlc } = tick(clockRef.current, Date.now());
  clockRef.current = clock;
  const payload = Buffer.from(JSON.stringify(body)).toString('base64');
  const response = await target.inject({
    method: 'POST',
    url: '/api/ops',
    cookies: { [SESSION_COOKIE]: sessionCookie },
    payload: { ops: [{ hlc, deviceId: clock.nodeId, opVersion: 1, payload }] },
  });
  if (response.statusCode !== 200) throw new Error(`push failed: ${response.statusCode} ${response.body}`);
}

describe('requireAdmin', () => {
  it('rejects an unauthenticated request with 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/users' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a non-admin user with 403', async () => {
    await setupAdmin(app);
    const cookie = await createAndLoginUser(app, 'bob', 'correct-horse-battery');
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('GET /api/admin/users', () => {
  it('lists every user', async () => {
    const adminCookie = await setupAdmin(app);
    await createAndLoginUser(app, 'bob', 'correct-horse-battery');

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/users',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    const { users } = response.json<{ users: { username: string }[] }>();
    expect(users.map((u) => u.username).sort()).toEqual(['alice', 'bob']);
  });
});

describe('POST /api/admin/users', () => {
  it('creates a user with no password and returns a one-time set-password link that works end to end', async () => {
    const adminCookie = await setupAdmin(app);

    const create = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: { username: 'carol' },
    });
    expect(create.statusCode).toBe(201);
    const { user, setPasswordUrl } = create.json<{ user: { username: string }; setPasswordUrl: string }>();
    expect(user.username).toBe('carol');
    const token = extractSetPasswordToken(setPasswordUrl);
    expect(token).toBeTruthy();

    const setPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/set-password',
      payload: { token, password: 'a-brand-new-password' },
    });
    expect(setPassword.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'carol', password: 'a-brand-new-password' },
    });
    expect(login.statusCode).toBe(200);

    // Single-use: the same token cannot be used again.
    const reuse = await app.inject({
      method: 'POST',
      url: '/api/auth/set-password',
      payload: { token, password: 'yet-another-password' },
    });
    expect(reuse.statusCode).toBe(401);
  });

  it('rejects username collisions with 409', async () => {
    const adminCookie = await setupAdmin(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/users',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: { username: 'alice' },
    });
    expect(response.statusCode).toBe(409);
  });

  it('is rejected with 409 while OIDC is configured', async () => {
    process.env.ASTRAYA_OIDC_ISSUER = 'http://localhost:1';
    process.env.ASTRAYA_OIDC_CLIENT_ID = 'client';
    process.env.ASTRAYA_PUBLIC_URL = 'http://localhost:8080';
    const dir2 = mkdtempSync(join(tmpdir(), 'astraya-admin-test-'));
    const oidcApp = await build({ dbPath: join(dir2, 'astraya.db') });
    try {
      const adminCookie = await setupAdmin(oidcApp);
      const response = await oidcApp.inject({
        method: 'POST',
        url: '/api/admin/users',
        cookies: { [SESSION_COOKIE]: adminCookie },
        payload: { username: 'dave' },
      });
      expect(response.statusCode).toBe(409);
    } finally {
      await oidcApp.close();
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

describe('POST /api/admin/users/:id/reset-password', () => {
  it('mints a fresh link without touching the account until the link is used', async () => {
    const adminCookie = await setupAdmin(app);
    const bobCookie = await createAndLoginUser(app, 'bob', 'original-password');
    const bob = (
      await app.inject({ method: 'GET', url: '/api/admin/users', cookies: { [SESSION_COOKIE]: adminCookie } })
    )
      .json<{ users: { id: string; username: string }[] }>()
      .users.find((u) => u.username === 'bob');
    if (!bob) throw new Error('bob not found');

    const reset = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${bob.id}/reset-password`,
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(reset.statusCode).toBe(200);

    // The old password still works until the new link is actually followed.
    const stillWorks = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: bobCookie },
    });
    expect(stillWorks.statusCode).toBe(200);
  });
});

describe('disable / enable / promote / demote', () => {
  it('disable immediately invalidates a live session, and enable lifts it', async () => {
    const adminCookie = await setupAdmin(app);
    const bobCookie = await createAndLoginUser(app, 'bob', 'correct-horse-battery');
    const bob = (
      await app.inject({ method: 'GET', url: '/api/admin/users', cookies: { [SESSION_COOKIE]: adminCookie } })
    )
      .json<{ users: { id: string; username: string }[] }>()
      .users.find((u) => u.username === 'bob');
    if (!bob) throw new Error('bob not found');

    const disable = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${bob.id}/disable`,
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(disable.statusCode).toBe(200);

    const rejected = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: bobCookie } });
    expect(rejected.statusCode).toBe(401);

    const enable = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${bob.id}/enable`,
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(enable.statusCode).toBe(200);

    const loginAgain = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'bob', password: 'correct-horse-battery' },
    });
    expect(loginAgain.statusCode).toBe(200);
  });

  it('promote and demote toggle is_admin', async () => {
    const adminCookie = await setupAdmin(app);
    const bobCookie = await createAndLoginUser(app, 'bob', 'correct-horse-battery');
    const bob = (
      await app.inject({ method: 'GET', url: '/api/admin/users', cookies: { [SESSION_COOKIE]: adminCookie } })
    )
      .json<{ users: { id: string; username: string }[] }>()
      .users.find((u) => u.username === 'bob');
    if (!bob) throw new Error('bob not found');

    const promote = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${bob.id}/promote`,
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(promote.json<{ user: { isAdmin: boolean } }>().user.isAdmin).toBe(true);

    // Bob is now an admin himself and can use his own (still-valid) session to demote back.
    const demote = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${bob.id}/demote`,
      cookies: { [SESSION_COOKIE]: bobCookie },
    });
    expect(demote.json<{ user: { isAdmin: boolean } }>().user.isAdmin).toBe(false);
  });
});

describe('the last-admin guard', () => {
  it('rejects disabling, demoting, and deleting the sole remaining admin with 409', async () => {
    const adminCookie = await setupAdmin(app);
    const me = (
      await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: adminCookie } })
    ).json<{ user: { id: string } }>().user;

    const disable = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${me.id}/disable`,
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(disable.statusCode).toBe(409);

    const demote = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${me.id}/demote`,
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(demote.statusCode).toBe(409);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${me.id}`,
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(deleteResponse.statusCode).toBe(409);
  });

  it('allows disabling a second admin once more than one exists', async () => {
    const adminCookie = await setupAdmin(app);
    await createAndLoginUser(app, 'bob', 'correct-horse-battery');
    const bob = (
      await app.inject({ method: 'GET', url: '/api/admin/users', cookies: { [SESSION_COOKIE]: adminCookie } })
    )
      .json<{ users: { id: string; username: string }[] }>()
      .users.find((u) => u.username === 'bob');
    if (!bob) throw new Error('bob not found');
    await app.inject({
      method: 'POST',
      url: `/api/admin/users/${bob.id}/promote`,
      cookies: { [SESSION_COOKIE]: adminCookie },
    });

    const disable = await app.inject({
      method: 'POST',
      url: `/api/admin/users/${bob.id}/disable`,
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(disable.statusCode).toBe(200);
  });
});

describe('GET /api/admin/users/:id/deletion-impact', () => {
  it('returns counted, distinct-entity counts that match hand-pushed ops', async () => {
    const adminCookie = await setupAdmin(app);
    const bobCookie = await createAndLoginUser(app, 'bob', 'correct-horse-battery');
    const bob = (
      await app.inject({ method: 'GET', url: '/api/admin/users', cookies: { [SESSION_COOKIE]: adminCookie } })
    )
      .json<{ users: { id: string; username: string }[] }>()
      .users.find((u) => u.username === 'bob');
    if (!bob) throw new Error('bob not found');

    const clockRef: ClockRef = { current: createClock(randomNodeId()) };
    await pushOp(app, bobCookie, clockRef, { entity: 'person', entityId: 'person-1', field: 'name', value: 'Ada' });
    await pushOp(app, bobCookie, clockRef, { entity: 'person', entityId: 'person-1', field: 'name', value: 'Ada L.' });
    await pushOp(app, bobCookie, clockRef, { entity: 'person', entityId: 'person-2', field: 'name', value: 'Bob' });
    await pushOp(app, bobCookie, clockRef, { entity: 'chart', entityId: 'chart-1', field: 'title', value: 'Natal' });

    const impact = await app.inject({
      method: 'GET',
      url: `/api/admin/users/${bob.id}/deletion-impact`,
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(impact.statusCode).toBe(200);
    expect(impact.json()).toEqual({ kind: 'counted', people: 2, charts: 1 });
  });

  it('returns an approximate row count when no encryption key is configured', async () => {
    delete process.env.ASTRAYA_ENCRYPTION_KEY;
    const dir2 = mkdtempSync(join(tmpdir(), 'astraya-admin-test-'));
    const unconfigured = await build({ dbPath: join(dir2, 'astraya.db') });
    try {
      const adminCookie = await setupAdmin(unconfigured);
      await createAndLoginUser(unconfigured, 'bob', 'correct-horse-battery', join(dir2, 'astraya.db'));
      const bob = (
        await unconfigured.inject({
          method: 'GET',
          url: '/api/admin/users',
          cookies: { [SESSION_COOKIE]: adminCookie },
        })
      )
        .json<{ users: { id: string; username: string }[] }>()
        .users.find((u) => u.username === 'bob');
      if (!bob) throw new Error('bob not found');

      const impact = await unconfigured.inject({
        method: 'GET',
        url: `/api/admin/users/${bob.id}/deletion-impact`,
        cookies: { [SESSION_COOKIE]: adminCookie },
      });
      expect(impact.statusCode).toBe(200);
      expect(impact.json()).toEqual({ kind: 'approximate', opRows: 0 });
    } finally {
      await unconfigured.close();
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

describe('DELETE /api/admin/users/:id', () => {
  it('deletes the user, cascading away their sessions and ops', async () => {
    const adminCookie = await setupAdmin(app);
    const bobCookie = await createAndLoginUser(app, 'bob', 'correct-horse-battery');
    const bob = (
      await app.inject({ method: 'GET', url: '/api/admin/users', cookies: { [SESSION_COOKIE]: adminCookie } })
    )
      .json<{ users: { id: string; username: string }[] }>()
      .users.find((u) => u.username === 'bob');
    if (!bob) throw new Error('bob not found');

    const clockRef: ClockRef = { current: createClock(randomNodeId()) };
    await pushOp(app, bobCookie, clockRef, { entity: 'person', entityId: 'person-1', field: 'name', value: 'Ada' });

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${bob.id}`,
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(deleteResponse.statusCode).toBe(200);

    const raw = new DatabaseSync(dbPath);
    const sessions = raw.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?').get(bob.id) as {
      count: number;
    };
    const ops = raw.prepare('SELECT COUNT(*) AS count FROM ops WHERE user_id = ?').get(bob.id) as { count: number };
    raw.close();
    expect(sessions.count).toBe(0);
    expect(ops.count).toBe(0);
  });

  it('returns 404 for an unknown user id', async () => {
    const adminCookie = await setupAdmin(app);
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/users/does-not-exist',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(response.statusCode).toBe(404);
  });
});
