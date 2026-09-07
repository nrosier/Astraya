/**
 * Tests for the two caching strategies (#99, #100), against a fake Cache
 * Storage rather than a real browser — the same kind of substitution
 * `test/worker-bridge.test.ts` makes for the ephemeris Worker.
 */
import { describe, expect, it, vi } from 'vitest';
import { cacheFirst, staleWhileRevalidate, type CacheLike, type CacheStorageLike } from '../src/pwa/strategies.js';

/** An in-memory Cache Storage, keyed by request URL as a real Cache effectively is. */
function fakeStorage(): CacheStorageLike & { readonly caches: Map<string, Map<string, Response>> } {
  const caches = new Map<string, Map<string, Response>>();
  return {
    caches,
    async open(name) {
      let cache = caches.get(name);
      if (cache === undefined) {
        cache = new Map();
        caches.set(name, cache);
      }
      const store = cache;
      return {
        async match(request) {
          const url = typeof request === 'string' ? request : request.url;
          return store.get(url);
        },
        async put(request, response) {
          const url = typeof request === 'string' ? request : request.url;
          store.set(url, response);
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

const URL_ = 'https://astraya.example/ephe/sepl_18.se1';

describe('cacheFirst', () => {
  it('serves the cached response without touching the network', async () => {
    const storage = fakeStorage();
    const cache = await storage.open('c');
    await cache.put(URL_, new Response('cached'));
    const fetchImpl = vi.fn();

    const response = await cacheFirst(storage, 'c', new Request(URL_), fetchImpl);

    expect(await response.text()).toBe('cached');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fetches and caches on a miss', async () => {
    const storage = fakeStorage();
    const fetchImpl = vi.fn(async () => new Response('fresh'));

    const response = await cacheFirst(storage, 'c', new Request(URL_), fetchImpl);

    expect(await response.text()).toBe('fresh');
    const cache = await storage.open('c');
    expect(await (await cache.match(URL_))?.text()).toBe('fresh');
  });

  it('does not cache a failed response', async () => {
    const storage = fakeStorage();
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));

    await cacheFirst(storage, 'c', new Request(URL_), fetchImpl);

    const cache = await storage.open('c');
    expect(await cache.match(URL_)).toBeUndefined();
  });

  it('propagates a network failure on a miss, rather than swallowing it', async () => {
    const storage = fakeStorage();
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });

    await expect(cacheFirst(storage, 'c', new Request(URL_), fetchImpl)).rejects.toThrow('offline');
  });
});

describe('staleWhileRevalidate', () => {
  it('returns the cached response immediately, without waiting on the network', async () => {
    const storage = fakeStorage();
    const cache = await storage.open('c');
    await cache.put(URL_, new Response('cached'));
    let resolveFetch: (() => void) | undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = () => {
            resolve(new Response('fresh'));
          };
        }),
    );

    const response = await staleWhileRevalidate(storage, 'c', new Request(URL_), fetchImpl);

    expect(await response.text()).toBe('cached');
    resolveFetch?.();
  });

  it('updates the cache in the background after serving the stale copy', async () => {
    const storage = fakeStorage();
    const cache = await storage.open('c');
    await cache.put(URL_, new Response('cached'));
    const fetchImpl = vi.fn(async () => new Response('fresh'));

    await staleWhileRevalidate(storage, 'c', new Request(URL_), fetchImpl);
    // The revalidation is fire-and-forget; give its microtasks a turn.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await (await cache.match(URL_))?.text()).toBe('fresh');
  });

  it('falls back to the network on a miss', async () => {
    const storage = fakeStorage();
    const fetchImpl = vi.fn(async () => new Response('fresh'));

    const response = await staleWhileRevalidate(storage, 'c', new Request(URL_), fetchImpl);

    expect(await response.text()).toBe('fresh');
  });

  it('throws a clear error on a miss with no network, rather than hanging', async () => {
    const storage = fakeStorage();
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline');
    });

    await expect(staleWhileRevalidate(storage, 'c', new Request(URL_), fetchImpl)).rejects.toThrow(/no cached page/i);
  });
});
