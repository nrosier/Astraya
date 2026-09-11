/**
 * `src/sync/auth-client.ts` against a real `build()` app listening on an
 * ephemeral port — `app.inject()` would work for the routes themselves, but
 * this module makes real `fetch()` calls, and that is exactly the seam worth
 * exercising for real.
 *
 * `auth-client.ts` uses relative paths (`/api/auth/login`, ...) because a
 * browser resolves those against the page it's running on. Node's `fetch` has
 * no such page, so each test installs a `globalThis.fetch` that resolves
 * against the test server's own base URL and — since these routes are
 * cookie-session based — carries the session cookie from one call to the next
 * the same way a browser's cookie jar would.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { build } from '../server/index.ts';
import { login, logout, me, AuthError } from '../src/sync/auth-client.ts';

const BOOTSTRAP_TOKEN = 'test-bootstrap-token';

process.env.LOG_LEVEL = 'silent';

let dir: string;
let app: FastifyInstance;
let baseUrl: string;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-auth-client-test-'));
  process.env.ASTRAYA_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
  app = await build({ dbPath: join(dir, 'astraya.db') });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind to a port');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;

  let cookie: string | undefined;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), baseUrl);
    const headers = new Headers(init?.headers);
    if (cookie !== undefined) headers.set('cookie', cookie);
    const response = await realFetch(url, { ...init, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie !== null) cookie = setCookie.split(';')[0];
    return response;
  };
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await app.close();
  delete process.env.ASTRAYA_BOOTSTRAP_TOKEN;
  rmSync(dir, { recursive: true, force: true });
});

async function setupAdmin(username = 'alice', password = 'correct-horse-battery'): Promise<void> {
  const response = await realFetch(new URL('/api/setup', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: BOOTSTRAP_TOKEN, username, password }),
  });
  if (!response.ok) throw new Error(`setup failed with status ${String(response.status)}`);
}

describe('login', () => {
  it('resolves with the signed-in user on success', async () => {
    await setupAdmin('alice', 'correct-horse-battery');
    const user = await login('alice', 'correct-horse-battery');
    expect(user.username).toBe('alice');
    expect(user.isAdmin).toBe(true);
  });

  it('throws an AuthError with the server’s own message on wrong credentials', async () => {
    await setupAdmin('alice', 'correct-horse-battery');
    await expect(login('alice', 'wrong-password')).rejects.toMatchObject({
      name: 'AuthError',
      status: 401,
      message: 'Invalid username or password',
    });
  });

  it('rejects a malformed request with its 400', async () => {
    await expect(login('', '')).rejects.toMatchObject({ status: 400 });
  });
});

describe('me', () => {
  it('resolves undefined when signed out, rather than throwing', async () => {
    expect(await me()).toBeUndefined();
  });

  it('resolves the signed-in user right after login', async () => {
    await setupAdmin('alice', 'correct-horse-battery');
    await login('alice', 'correct-horse-battery');
    const user = await me();
    expect(user?.username).toBe('alice');
  });

  it('throws, rather than returning undefined, for a failure that is not "signed out"', async () => {
    globalThis.fetch = () => Promise.reject(new Error('network is down'));
    await expect(me()).rejects.toThrow('network is down');
  });
});

describe('logout', () => {
  it('ends the session, so a later "me" call reports signed out', async () => {
    await setupAdmin('alice', 'correct-horse-battery');
    await login('alice', 'correct-horse-battery');
    await logout();
    expect(await me()).toBeUndefined();
  });

  it('resolves with no endSessionUrl for a local-account session (no OIDC involved)', async () => {
    await setupAdmin('alice', 'correct-horse-battery');
    await login('alice', 'correct-horse-battery');
    await expect(logout()).resolves.toEqual({});
  });

  it('resolves with no endSessionUrl when nobody was signed in', async () => {
    await expect(logout()).resolves.toEqual({});
  });
});

describe('AuthError', () => {
  it('is an Error subclass carrying the HTTP status', () => {
    const error = new AuthError('nope', 401);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(401);
    expect(error.message).toBe('nope');
  });
});
