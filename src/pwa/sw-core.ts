/**
 * The service worker's actual behaviour, as a plain function over a minimal
 * scope interface.
 *
 * `installServiceWorker` never touches a global `self`, so it is testable with a
 * fake `ServiceWorkerScope` and no real browser — the same separation
 * `src/ephemeris/worker.ts` makes between `serveEphemeris` and the Worker it
 * actually runs in. `src/sw.ts` is the thin entry point that calls this with the
 * real scope.
 */
import { classify } from './routing.js';
import { cacheFirst, staleWhileRevalidate, type CacheStorageLike } from './strategies.js';
import { ephemerisCacheName, shellCacheName, staleCaches } from './cache-names.js';

export interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface FetchEventLike {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}

export interface MessageEventLike {
  readonly data: unknown;
}

/** The slice of `ServiceWorkerGlobalScope` this module actually uses. */
export interface ServiceWorkerScope {
  readonly location: { readonly origin: string };
  readonly caches: CacheStorageLike;
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEventLike) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
}

export interface ServiceWorkerConfig {
  readonly version: string;
  readonly fetch: typeof fetch;
  /** Where to find the list of app-shell files to precache. Overridable for tests. */
  readonly manifestPath?: string;
}

const DEFAULT_MANIFEST_PATH = '/precache-manifest.json';

/**
 * The app shell's file list, written at build time by the `precacheManifest`
 * Vite plugin (`vite.config.ts`) because the real filenames are content-hashed
 * and unknowable to this module otherwise.
 *
 * Falls back to just `/` on any failure to read it: a worse precache is a worse
 * offline experience, not a broken one — the shell cache still fills in
 * opportunistically as `shell-asset` and `shell-navigate` requests come through.
 */
async function readManifest(fetchImpl: typeof fetch, manifestPath: string): Promise<readonly string[]> {
  try {
    const response = await fetchImpl(manifestPath);
    if (!response.ok) return ['/'];
    const parsed: unknown = await response.json();
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) return parsed;
    return ['/'];
  } catch {
    return ['/'];
  }
}

export function installServiceWorker(scope: ServiceWorkerScope, config: ServiceWorkerConfig): void {
  const { version, fetch: fetchImpl } = config;
  const manifestPath = config.manifestPath ?? DEFAULT_MANIFEST_PATH;

  scope.addEventListener('install', (event) => {
    event.waitUntil(
      (async () => {
        const paths = await readManifest(fetchImpl, manifestPath);
        const cache = await scope.caches.open(shellCacheName(version));
        await Promise.all(
          paths.map(async (path) => {
            const response = await fetchImpl(path);
            if (response.ok) await cache.put(path, response);
          }),
        );
      })(),
    );
  });

  scope.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        const names = await scope.caches.keys();
        await Promise.all(staleCaches(names, version).map((name) => scope.caches.delete(name)));
        await scope.clients.claim();
      })(),
    );
  });

  scope.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    const strategy = classify({
      pathname: url.pathname,
      method: event.request.method,
      sameOrigin: url.origin === scope.location.origin,
      mode: event.request.mode,
    });

    if (strategy === 'ephemeris') {
      event.respondWith(cacheFirst(scope.caches, ephemerisCacheName(version), event.request, fetchImpl));
    } else if (strategy === 'shell-asset') {
      event.respondWith(cacheFirst(scope.caches, shellCacheName(version), event.request, fetchImpl));
    } else if (strategy === 'shell-navigate') {
      event.respondWith(staleWhileRevalidate(scope.caches, shellCacheName(version), event.request, fetchImpl));
    }
    // 'bypass': no respondWith call at all, which is exactly "handle this as if
    // there were no service worker" — the required behaviour for /api/ and any
    // cross-origin request such as a future Authentik redirect.
  });

  // The other half of the explicit update flow in `src/pwa/register.ts`: this
  // worker sits in `waiting` until the page, after the visitor has confirmed,
  // asks it to take over. It never calls `skipWaiting` on its own.
  scope.addEventListener('message', (event) => {
    if (event.data === 'skip-waiting') void scope.skipWaiting();
  });
}
