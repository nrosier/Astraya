/**
 * Populate the ephemeris cache ahead of time, so the first offline session
 * already has every asset rather than discovering a gap mid-chart (#100).
 *
 * Runs on the main thread rather than inside the service worker: Cache Storage
 * is the same store from both, and doing it here means progress (~2.5 MB) can be
 * reported to the UI directly with no worker messaging protocol.
 */
import { ALL_ASSETS, EPHE_BASE_URL, type EphemerisAsset } from '../ephemeris/assets.js';
import { ephemerisCacheName } from './cache-names.js';
import type { CacheStorageLike } from './strategies.js';

export interface WarmProgress {
  readonly loadedBytes: number;
  readonly totalBytes: number;
}

/**
 * Skips whatever is already cached, so resuming after an interrupted warm-up —
 * or simply running again on a later visit — does not re-download files that
 * already made it in.
 *
 * A failed fetch throws immediately, naming which asset failed. It is the
 * caller's job to decide what that means for the UI; it must never be
 * swallowed, since a warm-up that silently leaves an asset uncached is exactly
 * the gap that turns into a silent Moshier fallback later.
 */
export async function warmEphemerisCache(
  storage: CacheStorageLike,
  version: string,
  fetchImpl: typeof fetch,
  assets: readonly EphemerisAsset[] = ALL_ASSETS,
  onProgress?: (progress: WarmProgress) => void,
): Promise<void> {
  const cache = await storage.open(ephemerisCacheName(version));
  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  let loadedBytes = 0;

  for (const asset of assets) {
    const url = `${EPHE_BASE_URL}${asset.file}`;
    const cached = await cache.match(url);
    if (cached === undefined) {
      const response = await fetchImpl(url);
      if (!response.ok) {
        throw new Error(`Failed to warm the ephemeris cache: ${asset.file} (HTTP ${String(response.status)})`);
      }
      await cache.put(url, response);
    }
    loadedBytes += asset.bytes;
    onProgress?.({ loadedBytes, totalBytes });
  }
}
