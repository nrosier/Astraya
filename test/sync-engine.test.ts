// @vitest-environment jsdom
/**
 * `src/sync/engine.ts` against a real `build()` server (listening on an
 * ephemeral port, not `app.inject()` — this module makes real `fetch()`
 * calls) and real `openStore()` stores (`fake-indexeddb`, already installed
 * globally by `test/setup.ts`). jsdom supplies `window` for the engine's
 * `online` listener.
 *
 * Same cookie-jar `fetch` trick as `test/sync-auth-client.test.ts`: the
 * engine's calls are relative paths a browser would resolve against its own
 * page, which Node's `fetch` cannot do on its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { build } from '../server/index.ts';
import { createSyncEngine } from '../src/sync/engine.ts';
import { openStore } from '../src/store/store.ts';

const BOOTSTRAP_TOKEN = 'test-bootstrap-token';
const WAIT = { timeout: 5000 };

process.env.LOG_LEVEL = 'silent';

let dir: string;
let app: FastifyInstance;
let baseUrl: string;
let fetchCalls: { method: string; url: string }[] = [];
let dbCounter = 0;
const realFetch = globalThis.fetch;

function freshDbName(): string {
  dbCounter += 1;
  return `astraya-sync-engine-test-${String(dbCounter)}`;
}

async function listenAndBootstrap(dbPath: string): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const built = await build({ dbPath });
  await built.listen({ port: 0, host: '127.0.0.1' });
  const address = built.server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind to a port');
  const url = `http://127.0.0.1:${String(address.port)}`;
  await realFetch(new URL('/api/setup', url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: BOOTSTRAP_TOKEN, username: 'alice', password: 'correct-horse-battery' }),
  });
  return { app: built, baseUrl: url };
}

/** A cookie-jar `fetch` for one session, resolving the engine's relative paths against `baseUrl`. */
function sessionFetch(): typeof fetch {
  let cookie: string | undefined;
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), baseUrl);
    fetchCalls.push({ method: init?.method ?? 'GET', url: url.pathname + url.search });
    const headers = new Headers(init?.headers);
    if (cookie !== undefined) headers.set('cookie', cookie);
    const response = await realFetch(url, { ...init, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie !== null) cookie = setCookie.split(';')[0];
    return response;
  };
}

async function loginAs(username: string, password: string): Promise<typeof fetch> {
  const fetchImpl = sessionFetch();
  const response = await fetchImpl(new URL('/api/auth/login', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`login failed with status ${String(response.status)}`);
  return fetchImpl;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-sync-engine-test-'));
  process.env.ASTRAYA_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
  process.env.ASTRAYA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  const started = await listenAndBootstrap(join(dir, 'astraya.db'));
  app = started.app;
  baseUrl = started.baseUrl;
  fetchCalls = [];
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await app.close();
  delete process.env.ASTRAYA_BOOTSTRAP_TOKEN;
  delete process.env.ASTRAYA_ENCRYPTION_KEY;
  rmSync(dir, { recursive: true, force: true });
});

describe('pushing', () => {
  it('sends a local write to the server and reports synced once it lands', async () => {
    globalThis.fetch = await loginAs('alice', 'correct-horse-battery');
    const store = await openStore({ name: freshDbName() });
    await store.mutate([{ entity: 'person', entityId: 'p1', field: 'displayName', value: 'Ada' }]);
    const engine = await createSyncEngine({ store });
    try {
      await vi.waitFor(() => {
        expect(engine.status.kind).toBe('synced');
      }, WAIT);
      expect(engine.pending()).toBe(0);

      const pull = await globalThis.fetch(new URL('/api/ops', baseUrl));
      const { ops } = (await pull.json()) as { ops: { payload: string }[] };
      expect(ops).toHaveLength(1);
    } finally {
      engine.close();
      store.close();
    }
  });
});

describe('pulling', () => {
  it('merges a record another device already pushed under the same account', async () => {
    globalThis.fetch = await loginAs('alice', 'correct-horse-battery');

    const deviceA = await openStore({ name: freshDbName() });
    await deviceA.mutate([{ entity: 'person', entityId: 'p1', field: 'displayName', value: 'Ada' }]);
    const engineA = await createSyncEngine({ store: deviceA });
    await vi.waitFor(() => {
      expect(engineA.status.kind).toBe('synced');
    }, WAIT);
    engineA.close();
    deviceA.close();

    const deviceB = await openStore({ name: freshDbName() });
    const engineB = await createSyncEngine({ store: deviceB });
    try {
      await vi.waitFor(() => {
        expect(deviceB.state.people.get('p1')?.displayName).toBe('Ada');
      }, WAIT);
      expect(engineB.status.kind).toBe('synced');
    } finally {
      engineB.close();
      deviceB.close();
    }
  });
});

describe('resuming', () => {
  it('picks up from the persisted cursor instead of re-pushing already-acknowledged records', async () => {
    globalThis.fetch = await loginAs('alice', 'correct-horse-battery');
    const name = freshDbName();

    const first = await openStore({ name });
    await first.mutate([{ entity: 'person', entityId: 'p1', field: 'displayName', value: 'Ada' }]);
    const engine1 = await createSyncEngine({ store: first });
    await vi.waitFor(() => {
      expect(engine1.status.kind).toBe('synced');
    }, WAIT);
    engine1.close();
    first.close();

    fetchCalls = [];
    const second = await openStore({ name });
    const engine2 = await createSyncEngine({ store: second });
    try {
      await vi.waitFor(() => {
        expect(engine2.status.kind).toBe('synced');
      }, WAIT);
      expect(fetchCalls.some((call) => call.method === 'POST' && call.url === '/api/ops')).toBe(false);
    } finally {
      engine2.close();
      second.close();
    }
  });
});

describe('failure', () => {
  it('reports a failing status carrying the error, rather than throwing out of the engine', async () => {
    delete process.env.ASTRAYA_ENCRYPTION_KEY;
    const disabledDir = mkdtempSync(join(tmpdir(), 'astraya-sync-engine-disabled-test-'));
    const disabled = await listenAndBootstrap(join(disabledDir, 'astraya.db'));
    baseUrl = disabled.baseUrl;

    try {
      globalThis.fetch = await loginAs('alice', 'correct-horse-battery');
      const store = await openStore({ name: freshDbName() });
      const engine = await createSyncEngine({ store });
      try {
        await vi.waitFor(() => {
          expect(engine.status.kind).toBe('failing');
        }, WAIT);
        expect(engine.status.kind === 'failing' && engine.status.message.length > 0).toBe(true);
      } finally {
        engine.close();
        store.close();
      }
    } finally {
      await disabled.app.close();
      rmSync(disabledDir, { recursive: true, force: true });
    }
  });
});
