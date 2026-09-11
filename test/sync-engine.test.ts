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

// The tests below (#106) fully replace `globalThis.fetch` with a stub rather than talking to
// the `beforeEach`-started server, so they can control exactly which response — or which kind
// of failure to throw — the engine sees, independent of anything the relay would really do.

describe('error classification (#106)', () => {
  it('classifies fetch itself throwing as offline', async () => {
    globalThis.fetch = async () => {
      throw new TypeError('fetch failed');
    };
    const store = await openStore({ name: freshDbName() });
    const engine = await createSyncEngine({ store });
    try {
      await vi.waitFor(() => {
        expect(engine.status.kind).toBe('failing');
      }, WAIT);
      expect(engine.status.kind === 'failing' && engine.status.message).toBe('No network connection.');
    } finally {
      engine.close();
      store.close();
    }
  });

  it('classifies a 401 as unauthorized, with a message pointing at signing in again', async () => {
    globalThis.fetch = async () => new Response(null, { status: 401 });
    const store = await openStore({ name: freshDbName() });
    const engine = await createSyncEngine({ store });
    try {
      await vi.waitFor(() => {
        expect(engine.status.kind).toBe('failing');
      }, WAIT);
      expect(engine.status.kind === 'failing' && engine.status.message).toBe(
        'Your session has expired. Sign in again to keep syncing.',
      );
    } finally {
      engine.close();
      store.close();
    }
  });

  it('classifies a 5xx as a server problem', async () => {
    globalThis.fetch = async () => new Response(null, { status: 503 });
    const store = await openStore({ name: freshDbName() });
    const engine = await createSyncEngine({ store });
    try {
      await vi.waitFor(() => {
        expect(engine.status.kind).toBe('failing');
      }, WAIT);
      expect(engine.status.kind === 'failing' && engine.status.message).toBe(
        'The server is having trouble (status 503).',
      );
    } finally {
      engine.close();
      store.close();
    }
  });

  it('classifies an unreadable response body as malformed', async () => {
    globalThis.fetch = async () => new Response('not json', { status: 200 });
    const store = await openStore({ name: freshDbName() });
    const engine = await createSyncEngine({ store });
    try {
      await vi.waitFor(() => {
        expect(engine.status.kind).toBe('failing');
      }, WAIT);
      expect(engine.status.kind === 'failing' && engine.status.message).toBe('The server response could not be read.');
    } finally {
      engine.close();
      store.close();
    }
  });

  it('classifies a response missing its operations array as malformed', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({}), { status: 200 });
    const store = await openStore({ name: freshDbName() });
    const engine = await createSyncEngine({ store });
    try {
      await vi.waitFor(() => {
        expect(engine.status.kind).toBe('failing');
      }, WAIT);
      expect(engine.status.kind === 'failing' && engine.status.message).toBe(
        'The server response was missing its operations.',
      );
    } finally {
      engine.close();
      store.close();
    }
  });

  it('surfaces the server’s own message for a clock-skew rejection on push', async () => {
    globalThis.fetch = async (_input, init) => {
      if (init?.method === 'POST') {
        return new Response(
          JSON.stringify({ error: 'clock-skew', message: "This device's clock is more than a day ahead." }),
          { status: 400 },
        );
      }
      return new Response(JSON.stringify({ ops: [] }), { status: 200 });
    };
    const store = await openStore({ name: freshDbName() });
    await store.mutate([{ entity: 'person', entityId: 'p1', field: 'displayName', value: 'Ada' }]);
    const engine = await createSyncEngine({ store });
    try {
      await vi.waitFor(() => {
        expect(engine.status.kind).toBe('failing');
      }, WAIT);
      expect(engine.status.kind === 'failing' && engine.status.message).toBe(
        "This device's clock is more than a day ahead.",
      );
    } finally {
      engine.close();
      store.close();
    }
  });

  it('classifies any other rejection on push using the server’s error field', async () => {
    globalThis.fetch = async (_input, init) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'batch too large' }), { status: 400 });
      }
      return new Response(JSON.stringify({ ops: [] }), { status: 200 });
    };
    const store = await openStore({ name: freshDbName() });
    await store.mutate([{ entity: 'person', entityId: 'p1', field: 'displayName', value: 'Ada' }]);
    const engine = await createSyncEngine({ store });
    try {
      await vi.waitFor(() => {
        expect(engine.status.kind).toBe('failing');
      }, WAIT);
      expect(engine.status.kind === 'failing' && engine.status.message).toBe('batch too large');
    } finally {
      engine.close();
      store.close();
    }
  });
});

describe('exponential backoff with jitter (#106)', () => {
  it('grows the retry delay after each consecutive failure', async () => {
    const attemptTimes: number[] = [];
    globalThis.fetch = async () => {
      attemptTimes.push(Date.now());
      return new Response(null, { status: 500 });
    };

    const store = await openStore({ name: freshDbName() });
    const engine = await createSyncEngine({ store });
    try {
      await vi.waitFor(
        () => {
          expect(attemptTimes.length).toBeGreaterThanOrEqual(3);
        },
        { timeout: 10_000 },
      );
    } finally {
      engine.close();
      store.close();
    }

    const [t0, t1, t2] = attemptTimes;
    if (t0 === undefined || t1 === undefined || t2 === undefined) throw new Error('expected at least 3 attempts');
    const gap1 = t1 - t0;
    const gap2 = t2 - t1;
    // First backoff is BASE_RETRY_MS (1s) jittered to 50-100%; the second consecutive
    // failure's is double that, jittered the same way. Loose bounds to absorb test-runner
    // scheduling noise, but tight enough that "no backoff" or "no growth" would fail them.
    expect(gap1).toBeGreaterThan(300);
    expect(gap1).toBeLessThan(1300);
    expect(gap2).toBeGreaterThan(gap1);
    expect(gap2).toBeLessThan(2600);
  }, 10_000);
});

describe('onUnauthorized (#106)', () => {
  it('is called exactly once per failure episode, not on every backoff retry', async () => {
    globalThis.fetch = async () => new Response(null, { status: 401 });
    const store = await openStore({ name: freshDbName() });
    const onUnauthorized = vi.fn();
    const engine = await createSyncEngine({ store, onUnauthorized });
    try {
      await vi.waitFor(() => {
        expect(onUnauthorized).toHaveBeenCalledTimes(1);
      }, WAIT);
      // Give at least one more backoff retry a chance to fire — still 401 every time — and
      // confirm the callback is not invoked again for it.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(onUnauthorized).toHaveBeenCalledTimes(1);
    } finally {
      engine.close();
      store.close();
    }
  }, 10_000);
});

describe('partial push recovery (#106)', () => {
  it('retries a push whose response never reached the client without duplicating the op server-side', async () => {
    const loggedIn = await loginAs('alice', 'correct-horse-battery');
    let postAttempts = 0;
    globalThis.fetch = async (input, init) => {
      if (init?.method === 'POST') {
        postAttempts += 1;
        // The real server processes this and commits the op — only the response back to the
        // client is what's simulated as lost, on the first attempt only.
        const response = await loggedIn(input, init);
        if (postAttempts === 1) throw new TypeError('network dropped mid-response');
        return response;
      }
      return loggedIn(input, init);
    };

    const store = await openStore({ name: freshDbName() });
    await store.mutate([{ entity: 'person', entityId: 'p1', field: 'displayName', value: 'Ada' }]);
    const engine = await createSyncEngine({ store });
    try {
      await vi.waitFor(
        () => {
          expect(engine.status.kind).toBe('synced');
        },
        { timeout: 10_000 },
      );
      expect(postAttempts).toBeGreaterThanOrEqual(2);

      // The server's (user, hlc) uniqueness made the retried, identical chunk a no-op —
      // exactly one row, not two, despite the op having actually reached the server twice.
      const pull = await loggedIn(new URL('/api/ops', baseUrl));
      const { ops } = (await pull.json()) as { ops: unknown[] };
      expect(ops).toHaveLength(1);
    } finally {
      engine.close();
      store.close();
    }
  }, 10_000);
});

describe('local writes are never blocked by a failing sync (#106)', () => {
  it('accepts a mutate() while the engine is failing', async () => {
    globalThis.fetch = async () => new Response(null, { status: 500 });
    const store = await openStore({ name: freshDbName() });
    const engine = await createSyncEngine({ store });
    try {
      await vi.waitFor(() => {
        expect(engine.status.kind).toBe('failing');
      }, WAIT);
      await store.mutate([{ entity: 'person', entityId: 'p1', field: 'displayName', value: 'Ada' }]);
      expect(store.state.people.get('p1')?.displayName).toBe('Ada');
    } finally {
      engine.close();
      store.close();
    }
  });
});
