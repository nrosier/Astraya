/**
 * Service worker entry point.
 *
 * Built separately from the app by `vite.sw.config.ts` into `dist/sw.js`, as a
 * classic (non-module) script — service worker registration with
 * `{ type: 'module' }` is not universally supported, and this way it works with
 * none.
 *
 * `__APP_VERSION__` is substituted by that same build, from the same
 * `package.json` the app reads its own version from (`src/version.ts`), so a new
 * release always gets a fresh, distinct cache — see `src/pwa/cache-names.ts`.
 */
import { installServiceWorker, type ServiceWorkerScope } from './pwa/sw-core.js';

declare const __APP_VERSION__: string;

// Self-start only when genuinely running as a service worker. The guard keeps
// this module importable from tests — none currently import it directly, since
// `installServiceWorker` is what they exercise, but the guard matches the same
// pattern `src/ephemeris/worker.ts` uses for the same reason.
if (typeof ServiceWorkerGlobalScope !== 'undefined' && globalThis instanceof ServiceWorkerGlobalScope) {
  installServiceWorker(globalThis as unknown as ServiceWorkerScope, {
    version: __APP_VERSION__,
    fetch: fetch.bind(globalThis),
  });
}
