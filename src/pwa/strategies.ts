/**
 * The two caching strategies the service worker uses, as plain functions over a
 * minimal slice of the Cache Storage API.
 *
 * Kept separate from `sw-core.ts` so each is independently testable against a
 * fake `CacheStorageLike` — no real browser, no real network — the same reason
 * `src/ephemeris/worker.ts` separates `dispatch` from the scope it runs in.
 */

export interface CacheLike {
  match(request: RequestInfo): Promise<Response | undefined>;
  put(request: RequestInfo, response: Response): Promise<void>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

/**
 * Serve from cache when present; otherwise fetch, cache a copy, and serve that.
 *
 * Used for the ephemeris assets and the hashed build assets: both are immutable
 * for the life of a release, so there is never a reason to prefer the network
 * once a copy is cached. A failed fetch on a cache miss propagates as-is — for
 * the ephemeris assets that is deliberate: the engine's own check for a partial
 * load (`src/ephemeris/engine.ts`) is what turns that into the loud, specific
 * error #100 requires, and duplicating that logic here would be a second place
 * for it to drift from.
 */
export async function cacheFirst(
  storage: CacheStorageLike,
  cacheName: string,
  request: Request,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const cache = await storage.open(cacheName);
  const cached = await cache.match(request);
  if (cached !== undefined) return cached;
  const response = await fetchImpl(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/**
 * Serve the cached copy immediately when one exists, while refetching in the
 * background to update the cache for next time; fetch when there is nothing
 * cached yet. Used only for navigation: the app shell's HTML should never make a
 * visit wait on the network, but it also should not go stale forever.
 */
export async function staleWhileRevalidate(
  storage: CacheStorageLike,
  cacheName: string,
  request: Request,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const cache = await storage.open(cacheName);
  const cached = await cache.match(request);
  const revalidated = fetchImpl(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);

  if (cached !== undefined) {
    // Deliberately not awaited: the response the visitor gets must not wait on
    // the network, only the cache write that happens after it does.
    void revalidated;
    return cached;
  }
  const fetched = await revalidated;
  if (fetched === undefined) throw new Error('No cached page, and the network request failed.');
  return fetched;
}
