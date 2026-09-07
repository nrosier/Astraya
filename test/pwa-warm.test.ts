/**
 * Tests for warming the ephemeris cache ahead of time (#100).
 */
import { describe, expect, it, vi } from 'vitest';
import { warmEphemerisCache } from '../src/pwa/warm.js';
import { ephemerisCacheName } from '../src/pwa/cache-names.js';
import { EPHE_BASE_URL, type EphemerisAsset } from '../src/ephemeris/assets.js';
import type { CacheLike, CacheStorageLike } from '../src/pwa/strategies.js';

function fakeStorage(): CacheStorageLike {
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

const ASSETS: readonly EphemerisAsset[] = [
  {
    file: 'sepl_18.se1',
    from: 'dist/ephe/sepl_18.se1',
    bytes: 484_055,
    sha256: 'a'.repeat(64),
    description: 'Planets',
  },
  {
    file: 'swisseph.wasm',
    from: 'dist/wasm/swisseph.wasm',
    bytes: 584_227,
    sha256: 'b'.repeat(64),
    description: 'WASM',
  },
];

const VERSION = '0.4.0';

describe('warmEphemerisCache', () => {
  it('fetches and caches every asset not already present', async () => {
    const storage = fakeStorage();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return new Response(`bytes:${url}`);
    });

    await warmEphemerisCache(storage, VERSION, fetchImpl, ASSETS);

    const cache = await storage.open(ephemerisCacheName(VERSION));
    for (const asset of ASSETS) {
      const cached = await cache.match(`${EPHE_BASE_URL}${asset.file}`);
      expect(await cached?.text()).toBe(`bytes:${EPHE_BASE_URL}${asset.file}`);
    }
  });

  it('skips assets already cached, so a resumed warm-up does not re-download them', async () => {
    const storage = fakeStorage();
    const cache = await storage.open(ephemerisCacheName(VERSION));
    await cache.put(`${EPHE_BASE_URL}sepl_18.se1`, new Response('already-here'));
    const fetchImpl = vi.fn(async () => new Response('fresh'));

    await warmEphemerisCache(storage, VERSION, fetchImpl, ASSETS);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(`${EPHE_BASE_URL}swisseph.wasm`);
  });

  it('reports cumulative byte progress across assets', async () => {
    const storage = fakeStorage();
    const fetchImpl = vi.fn(async () => new Response('x'));
    const progress: { loadedBytes: number; totalBytes: number }[] = [];

    await warmEphemerisCache(storage, VERSION, fetchImpl, ASSETS, (p) => progress.push({ ...p }));

    expect(progress).toEqual([
      { loadedBytes: 484_055, totalBytes: 1_068_282 },
      { loadedBytes: 1_068_282, totalBytes: 1_068_282 },
    ]);
  });

  it('throws immediately, naming the failed asset, rather than leaving a silent gap', async () => {
    const storage = fakeStorage();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('swisseph.wasm')) return new Response('err', { status: 500 });
      return new Response('ok');
    });

    await expect(warmEphemerisCache(storage, VERSION, fetchImpl, ASSETS)).rejects.toThrow(/swisseph\.wasm/);
  });
});
