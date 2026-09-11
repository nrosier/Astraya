/**
 * The local-account HTTP surface (`server/auth/routes.ts`), exercised through
 * Fastify's `app.inject()` — no real socket needed. Each test gets its own
 * SQLite file (not `:memory:`): a couple of tests open a second, independent
 * connection to the same file to simulate out-of-band admin action (disabling
 * a user) while a session is live, which `:memory:` can't do since two
 * `DatabaseSync(':memory:')` connections never share state.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { build } from '../server/index.ts';
import { clearLoginThrottle } from '../server/auth/login-throttle.ts';

const BOOTSTRAP_TOKEN = 'test-bootstrap-token';
const SESSION_COOKIE = 'astraya_session';

// Fastify's request/response logging is noise here — these tests assert on
// HTTP responses, not log lines.
process.env.LOG_LEVEL = 'silent';

let dir: string;
let dbPath: string;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-auth-test-'));
  dbPath = join(dir, 'astraya.db');
  process.env.ASTRAYA_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
  app = await build({ dbPath });
});

afterEach(async () => {
  await app.close();
  delete process.env.ASTRAYA_BOOTSTRAP_TOKEN;
  rmSync(dir, { recursive: true, force: true });
  clearLoginThrottle('admin');
});

function setupAdmin(username = 'admin', password = 'correct-horse-battery') {
  return app.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { token: BOOTSTRAP_TOKEN, username, password },
  });
}

describe('POST /api/setup', () => {
  it('creates the first admin and sets a session cookie', async () => {
    const response = await setupAdmin();
    expect(response.statusCode).toBe(201);
    const body = response.json<{ user: { username: string; isAdmin: boolean } }>();
    expect(body.user.username).toBe('admin');
    expect(body.user.isAdmin).toBe(true);

    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');
    // inject() simulates a plain-http request, so Secure must be absent.
    expect(cookie?.secure).toBeFalsy();
  });

  it('returns 404, not 403, once an admin already exists', async () => {
    await setupAdmin();
    const second = await setupAdmin('someone-else');
    expect(second.statusCode).toBe(404);
  });

  it('rejects the wrong bootstrap token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { token: 'not-the-token', username: 'admin', password: 'correct-horse-battery' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a weak password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { token: BOOTSTRAP_TOKEN, username: 'admin', password: 'short' },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('POST /api/auth/login and GET /api/auth/me', () => {
  it('logs in with the created account and can fetch /api/auth/me', async () => {
    await setupAdmin('admin', 'correct-horse-battery');
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'correct-horse-battery' },
    });
    expect(login.statusCode).toBe(200);
    const sessionId = login.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
    expect(sessionId).toBeDefined();

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: String(sessionId) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ user: { username: string } }>().user.username).toBe('admin');
  });

  it('returns 401 with no session cookie', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(me.statusCode).toBe(401);
  });

  it('rejects a wrong password and a nonexistent username with the identical response', async () => {
    await setupAdmin('admin', 'correct-horse-battery');
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'not-the-password' },
    });
    const noSuchUser = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nobody-registered', password: 'whatever-12345' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(noSuchUser.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(noSuchUser.json());
  });

  it('throttles repeated failed logins for one username', async () => {
    await setupAdmin('admin', 'correct-horse-battery');
    const attempts = [];
    for (let i = 0; i < 6; i++) {
      attempts.push(
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { username: 'admin', password: 'wrong-password' },
        }),
      );
    }
    expect(attempts.some((response) => response.statusCode === 429)).toBe(true);
  });

  it('rejects a session whose user has since been disabled', async () => {
    await setupAdmin('admin', 'correct-horse-battery');
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'correct-horse-battery' },
    });
    const sessionId = String(login.cookies.find((c) => c.name === SESSION_COOKIE)?.value);

    // A second, independent connection to the same file: simulates an admin
    // disabling this account elsewhere while the session above is still live.
    const raw = new DatabaseSync(dbPath);
    raw.prepare("UPDATE users SET disabled_at = ? WHERE username = 'admin'").run(new Date().toISOString());
    raw.close();

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: sessionId },
    });
    expect(me.statusCode).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('revokes the session, so /api/auth/me is 401 afterward', async () => {
    await setupAdmin('admin', 'correct-horse-battery');
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'correct-horse-battery' },
    });
    const sessionId = String(login.cookies.find((c) => c.name === SESSION_COOKIE)?.value);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: sessionId },
    });
    expect(logout.statusCode).toBe(200);

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: sessionId },
    });
    expect(me.statusCode).toBe(401);
  });

  it('is a no-op with no session cookie', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(response.statusCode).toBe(200);
  });
});
