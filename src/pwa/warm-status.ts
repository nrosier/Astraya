/**
 * Subscribable wrapper around `warmEphemerisCache` for the UI (#100).
 *
 * Thin and deliberately untested, for the same reason as `register.ts`: the
 * logic worth testing — which assets, skip-if-cached, fail loudly — already has
 * a suite in `test/pwa-warm.test.ts` against `warm.ts` directly. This module is
 * nothing but wiring that to `caches`/`fetch` and a run-once guard.
 */
import { ALL_ASSETS } from '../ephemeris/assets.js';
import { APP_VERSION } from '../version.js';
import { warmEphemerisCache, type WarmProgress } from './warm.js';

export type WarmState =
  | { readonly kind: 'idle' }
  | ({ readonly kind: 'warming' } & WarmProgress)
  | { readonly kind: 'done' }
  | { readonly kind: 'failed'; readonly message: string };

let state: WarmState = { kind: 'idle' };
const listeners = new Set<() => void>();
let started = false;

function setState(next: WarmState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeToWarmState(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getWarmState(): WarmState {
  return state;
}

/**
 * Runs at most once per page load. Gated on `navigator.onLine`: warming while
 * offline would just fail on every asset, which is not the "offline" failure
 * this app should ever surface — the point is to have warmed *before* going
 * offline, per #100's "first run online must warm the cache" requirement.
 */
export function startWarming(): void {
  if (started || !navigator.onLine) return;
  started = true;
  setState({ kind: 'warming', loadedBytes: 0, totalBytes: 0 });

  warmEphemerisCache(caches, APP_VERSION, fetch, ALL_ASSETS, (progress) => {
    setState({ kind: 'warming', ...progress });
  })
    .then(() => {
      setState({ kind: 'done' });
    })
    .catch((error: unknown) => {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    });
}
