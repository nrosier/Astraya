/**
 * Tests for `installServiceWorker` (#99, #100), against a fake service-worker
 * scope rather than a real browser — the same substitution
 * `test/worker-bridge.test.ts` makes for the ephemeris Worker via `loopback()`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  installServiceWorker,
  type ExtendableEventLike,
  type FetchEventLike,
  type MessageEventLike,
  type ServiceWorkerScope,
} from '../src/pwa/sw-core.js';
import { ephemerisCacheName, shellCacheName } from '../src/pwa/cache-names.js';
import type { CacheLike, CacheStorageLike } from '../src/pwa/strategies.js';

function fakeCacheStorage(): CacheStorageLike {
  const caches = new Map<string, Map<string, Response>>();
  return {
    async open(name) {
      let cache = caches.get(name);
      if (cache === undefined) {
        cache = new Map();
        caches.set(name, cache);
      }
      const store = cache;
      return {
        async match(request) {
          return store.get(typeof request === 'string' ? request : request.url);
        },
        async put(request, response) {
          store.set(typeof request === 'string' ? request : request.url, response);
        },
      } satisfies CacheLike;
    },
    async keys() {
      return [...caches.keys()];
    },
    async delete(name) {
      return caches.delete(name);
    },
  };
}

interface FakeScope {
  readonly scope: ServiceWorkerScope;
  fireInstall(): Promise<void>;
  fireActivate(): Promise<void>;
  fireFetch(request: Request): Promise<Response | undefined>;
  fireMessage(data: unknown): void;
  readonly caches: CacheStorageLike;
  readonly claimed: () => boolean;
  readonly skipWaitingCalled: () => boolean;
}

function fakeScope(origin: string): FakeScope {
  let installListener: ((event: ExtendableEventLike) => void) | undefined;
  let activateListener: ((event: ExtendableEventLike) => void) | undefined;
  let fetchListener: ((event: FetchEventLike) => void) | undefined;
  let messageListener: ((event: MessageEventLike) => void) | undefined;
  let claimed = false;
  let skipWaitingCalled = false;
  const caches = fakeCacheStorage();

  const scope: ServiceWorkerScope = {
    location: { origin },
    caches,
    clients: {
      async claim() {
        claimed = true;
      },
    },
    async skipWaiting() {
      skipWaitingCalled = true;
    },
    addEventListener: (type: string, listener: unknown) => {
      if (type === 'install') installListener = listener as typeof installListener;
      else if (type === 'activate') activateListener = listener as typeof activateListener;
      else if (type === 'fetch') fetchListener = listener as typeof fetchListener;
      else if (type === 'message') messageListener = listener as typeof messageListener;
    },
  };

  return {
    scope,
    caches,
    claimed: () => claimed,
    skipWaitingCalled: () => skipWaitingCalled,
    async fireInstall() {
      const waits: Promise<unknown>[] = [];
      installListener?.({ waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
    },
    async fireActivate() {
      const waits: Promise<unknown>[] = [];
      activateListener?.({ waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
    },
    async fireFetch(request) {
      let responded: Response | Promise<Response> | undefined;
      fetchListener?.({
        request,
        respondWith: (r) => {
          responded = r;
        },
      });
      return responded === undefined ? undefined : await responded;
    },
    fireMessage(data) {
      messageListener?.({ data });
    },
  };
}

const ORIGIN = 'https://astraya.example';
const VERSION = '0.4.0';

function fetchServing(routes: Record<string, string | number>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, ORIGIN).pathname;
    const body = routes[path];
    if (body === undefined) return new Response('not found', { status: 404 });
    if (typeof body === 'number') return new Response('error', { status: body });
    return new Response(body);
  });
}

describe('installServiceWorker: install', () => {
  it('precaches every path named in the manifest', async () => {
    const fetchImpl = fetchServing({
      '/precache-manifest.json': JSON.stringify(['/', '/assets/index.js']),
      '/': '<html>shell</html>',
      '/assets/index.js': 'console.log(1)',
    });
    const fake = fakeScope(ORIGIN);
    installServiceWorker(fake.scope, { version: VERSION, fetch: fetchImpl });

    await fake.fireInstall();

    const cache = await fake.caches.open(shellCacheName(VERSION));
    expect(await (await cache.match('/'))?.text()).toBe('<html>shell</html>');
    expect(await (await cache.match('/assets/index.js'))?.text()).toBe('console.log(1)');
  });

  it('falls back to precaching just "/" when the manifest cannot be fetched', async () => {
    const fetchImpl = fetchServing({ '/': '<html>shell</html>' });
    const fake = fakeScope(ORIGIN);
    installServiceWorker(fake.scope, { version: VERSION, fetch: fetchImpl });

    await fake.fireInstall();

    const cache = await fake.caches.open(shellCacheName(VERSION));
    expect(await (await cache.match('/'))?.text()).toBe('<html>shell</html>');
  });
});

describe('installServiceWorker: activate', () => {
  it('deletes stale-version caches and claims clients', async () => {
    const fetchImpl = fetchServing({});
    const fake = fakeScope(ORIGIN);
    await (await fake.caches.open(shellCacheName('0.3.0'))).put('/', new Response('old'));
    await (await fake.caches.open(ephemerisCacheName(VERSION))).put('/ephe/x', new Response('keep'));
    installServiceWorker(fake.scope, { version: VERSION, fetch: fetchImpl });

    await fake.fireActivate();

    expect(await fake.caches.keys()).not.toContain(shellCacheName('0.3.0'));
    expect(await fake.caches.keys()).toContain(ephemerisCacheName(VERSION));
    expect(fake.claimed()).toBe(true);
  });
});

describe('installServiceWorker: fetch', () => {
  it('does not intercept a bypassed request at all', async () => {
    const fetchImpl = fetchServing({});
    const fake = fakeScope(ORIGIN);
    installServiceWorker(fake.scope, { version: VERSION, fetch: fetchImpl });

    const response = await fake.fireFetch(new Request(`${ORIGIN}/api/ops`, { method: 'POST' }));

    expect(response).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('serves an ephemeris asset cache-first', async () => {
    const fetchImpl = fetchServing({ '/ephe/sepl_18.se1': 'ephemeris-bytes' });
    const fake = fakeScope(ORIGIN);
    installServiceWorker(fake.scope, { version: VERSION, fetch: fetchImpl });

    const response = await fake.fireFetch(new Request(`${ORIGIN}/ephe/sepl_18.se1`, { mode: 'cors' }));

    expect(await response?.text()).toBe('ephemeris-bytes');
    const cache = await fake.caches.open(ephemerisCacheName(VERSION));
    expect(await (await cache.match(`${ORIGIN}/ephe/sepl_18.se1`))?.text()).toBe('ephemeris-bytes');
  });

  it('serves a navigation request stale-while-revalidate from the shell cache', async () => {
    const fetchImpl = fetchServing({ '/': 'fresh-shell' });
    const fake = fakeScope(ORIGIN);
    await (await fake.caches.open(shellCacheName(VERSION))).put(`${ORIGIN}/`, new Response('cached-shell'));
    installServiceWorker(fake.scope, { version: VERSION, fetch: fetchImpl });

    // The Request constructor rejects mode: 'navigate' directly (only the
    // browser's own navigation can create one), so fake it the way a real
    // FetchEvent's request would report it.
    const navigationRequest = new Request(`${ORIGIN}/`);
    Object.defineProperty(navigationRequest, 'mode', { value: 'navigate' });
    const response = await fake.fireFetch(navigationRequest);

    expect(await response?.text()).toBe('cached-shell');
  });

  it('caches every navigation URL under the same canonical shell entry (#323, #313a)', async () => {
    const fetchImpl = fetchServing({ '/': 'fresh-shell' });
    const fake = fakeScope(ORIGIN);
    installServiceWorker(fake.scope, { version: VERSION, fetch: fetchImpl });

    function navigationRequest(url: string): Request {
      const request = new Request(url);
      Object.defineProperty(request, 'mode', { value: 'navigate' });
      return request;
    }

    await fake.fireFetch(navigationRequest(`${ORIGIN}/`));
    // A different path/query on the same navigable app (a deep link, or an OIDC callback
    // carrying a one-time `code`/`state`) must not become its own cache entry — every
    // shell-navigate URL serves the same shell HTML, and a query string must never be
    // durably written into Cache Storage.
    await fake.fireFetch(navigationRequest(`${ORIGIN}/auth/oidc/callback?code=abc&state=xyz`));

    // Both requests were served/refreshed against the one canonical URL — the fetch
    // mock never saw the callback's query string, and the cache holds it under the
    // canonical key rather than a second, separate entry for that URL.
    const fetchedUrls = vi
      .mocked(fetchImpl)
      .mock.calls.map(([input]) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url));
    expect(fetchedUrls.every((url) => url === `${ORIGIN}/`)).toBe(true);
    const cache = await fake.caches.open(shellCacheName(VERSION));
    expect(await (await cache.match(`${ORIGIN}/auth/oidc/callback?code=abc&state=xyz`))?.text()).toBeUndefined();
    expect(await (await cache.match(`${ORIGIN}/`))?.text()).toBe('fresh-shell');
  });
});

describe('installServiceWorker: basePath', () => {
  it('precaches from and falls back to the manifest under basePath, not "/"', async () => {
    const fetchImpl = fetchServing({
      '/Astraya/precache-manifest.json': JSON.stringify(['/Astraya/', '/Astraya/assets/index.js']),
      '/Astraya/': '<html>shell</html>',
      '/Astraya/assets/index.js': 'console.log(1)',
    });
    const fake = fakeScope(ORIGIN);
    installServiceWorker(fake.scope, { version: VERSION, fetch: fetchImpl, basePath: '/Astraya/' });

    await fake.fireInstall();

    const cache = await fake.caches.open(shellCacheName(VERSION));
    expect(await (await cache.match('/Astraya/'))?.text()).toBe('<html>shell</html>');
    expect(await (await cache.match('/Astraya/assets/index.js'))?.text()).toBe('console.log(1)');
  });

  it('falls back to precaching just basePath when the manifest cannot be fetched', async () => {
    const fetchImpl = fetchServing({ '/Astraya/': '<html>shell</html>' });
    const fake = fakeScope(ORIGIN);
    installServiceWorker(fake.scope, { version: VERSION, fetch: fetchImpl, basePath: '/Astraya/' });

    await fake.fireInstall();

    const cache = await fake.caches.open(shellCacheName(VERSION));
    expect(await (await cache.match('/Astraya/'))?.text()).toBe('<html>shell</html>');
  });

  it('classifies a request under basePath as if it were root-relative', async () => {
    const fetchImpl = fetchServing({ '/Astraya/ephe/sepl_18.se1': 'ephemeris-bytes' });
    const fake = fakeScope(ORIGIN);
    installServiceWorker(fake.scope, { version: VERSION, fetch: fetchImpl, basePath: '/Astraya/' });

    const response = await fake.fireFetch(new Request(`${ORIGIN}/Astraya/ephe/sepl_18.se1`, { mode: 'cors' }));

    expect(await response?.text()).toBe('ephemeris-bytes');
    const cache = await fake.caches.open(ephemerisCacheName(VERSION));
    expect(await (await cache.match(`${ORIGIN}/Astraya/ephe/sepl_18.se1`))?.text()).toBe('ephemeris-bytes');
  });

  it('still bypasses /api/ requests when nested under basePath', async () => {
    const fetchImpl = fetchServing({});
    const fake = fakeScope(ORIGIN);
    installServiceWorker(fake.scope, { version: VERSION, fetch: fetchImpl, basePath: '/Astraya/' });

    const response = await fake.fireFetch(new Request(`${ORIGIN}/api/ops`, { method: 'POST' }));

    expect(response).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('installServiceWorker: message', () => {
  it('calls skipWaiting only when told to, never on its own', async () => {
    const fake = fakeScope(ORIGIN);
    installServiceWorker(fake.scope, { version: VERSION, fetch: fetchServing({}) });

    fake.fireMessage('something-else');
    expect(fake.skipWaitingCalled()).toBe(false);

    fake.fireMessage('skip-waiting');
    expect(fake.skipWaitingCalled()).toBe(true);
  });
});
