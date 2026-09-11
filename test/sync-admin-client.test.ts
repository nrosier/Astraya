/**
 * `src/sync/admin-client.ts` against a real `build()` app listening on an
 * ephemeral port — same reasoning as `test/sync-auth-client.test.ts`: this
 * module makes real `fetch()` calls, so that seam is what's worth exercising,
 * not `app.inject()`. The server-side behavior itself (last-admin guard,
 * OIDC-configured rejection, cascading delete, ...) is already covered by
 * `test/server-admin.test.ts`; this file only checks the client wrapper maps
 * each route's request/response shape and error case correctly.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { build } from '../server/index.ts';
import { login } from '../src/sync/auth-client.ts';
import {
  AdminError,
  createUser,
  deleteUser,
  demoteUser,
  disableUser,
  enableUser,
  getDeletionImpact,
  listUsers,
  promoteUser,
  resetPassword,
} from '../src/sync/admin-client.ts';

const BOOTSTRAP_TOKEN = 'test-bootstrap-token';

process.env.LOG_LEVEL = 'silent';

let dir: string;
let app: FastifyInstance;
let baseUrl: string;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-admin-client-test-'));
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

describe('listUsers / createUser', () => {
  it('lists the bootstrap admin, then the newly created user too', async () => {
    await setupAdmin();
    await login('alice', 'correct-horse-battery');

    expect((await listUsers()).map((u) => u.username)).toEqual(['alice']);

    const { user, setPasswordUrl } = await createUser('bob');
    expect(user.username).toBe('bob');
    expect(setPasswordUrl).toContain('#/set-password?token=');

    expect((await listUsers()).map((u) => u.username).sort()).toEqual(['alice', 'bob']);
  });

  it('throws AdminError for a non-admin caller', async () => {
    await setupAdmin();
    await login('alice', 'correct-horse-battery');
    const { setPasswordUrl } = await createUser('bob');

    // The same cookie jar (installed in `beforeEach`) carries whichever session is
    // current, so setting bob's password and signing in as him overwrites it in place.
    const token = new URL(setPasswordUrl.replace('/#', ''), baseUrl).searchParams.get('token');
    const setPasswordResponse = await fetch(new URL('/api/auth/set-password', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: 'a-fresh-password' }),
    });
    if (!setPasswordResponse.ok) throw new Error('set-password failed');
    await login('bob', 'a-fresh-password');

    await expect(listUsers()).rejects.toMatchObject({ name: 'AdminError', status: 403 });
  });
});

describe('resetPassword', () => {
  it('mints a fresh one-time link for an existing user', async () => {
    await setupAdmin();
    await login('alice', 'correct-horse-battery');
    const { user } = await createUser('bob');

    const { setPasswordUrl } = await resetPassword(user.id);
    expect(setPasswordUrl).toContain('#/set-password?token=');
  });
});

describe('disable / enable / promote / demote', () => {
  it('round-trip through the client wrappers', async () => {
    await setupAdmin();
    await login('alice', 'correct-horse-battery');
    const { user } = await createUser('bob');

    const disabled = await disableUser(user.id);
    expect(disabled.disabledAt).not.toBeNull();

    const enabled = await enableUser(user.id);
    expect(enabled.disabledAt).toBeNull();

    const promoted = await promoteUser(user.id);
    expect(promoted.isAdmin).toBe(true);

    const demoted = await demoteUser(user.id);
    expect(demoted.isAdmin).toBe(false);
  });
});

describe('getDeletionImpact / deleteUser', () => {
  it('reports an approximate impact with no ops, then deletes', async () => {
    await setupAdmin();
    await login('alice', 'correct-horse-battery');
    const { user } = await createUser('bob');

    const impact = await getDeletionImpact(user.id);
    expect(impact).toEqual({ kind: 'approximate', opRows: 0 });

    await deleteUser(user.id);
    expect((await listUsers()).map((u) => u.username)).toEqual(['alice']);
  });

  it('throws AdminError with the server’s message for an unknown user id', async () => {
    await setupAdmin();
    await login('alice', 'correct-horse-battery');
    await expect(deleteUser('does-not-exist')).rejects.toBeInstanceOf(AdminError);
  });
});
