/**
 * Service worker registration, and the explicit update-confirmation flow (#99).
 *
 * Thin and deliberately untested: it is nothing but browser API calls with no
 * logic of its own to isolate — the actual decisions (which strategy, which
 * cache, when to skip waiting) live in `sw-core.ts`, which is tested.
 *
 * The service worker never calls `self.skipWaiting()` on its own; it only does
 * so on receiving `'skip-waiting'`, which this module sends only after
 * `applyUpdate()` is called — i.e. only after the visitor has confirmed via the
 * banner in `PwaStatus.tsx`. That is what keeps an update from silently
 * swapping the app the visitor is mid-session with.
 */

export type UpdateState = { readonly kind: 'none' } | { readonly kind: 'available' };

let state: UpdateState = { kind: 'none' };
const listeners = new Set<() => void>();
let waitingWorker: ServiceWorker | undefined;
let refreshing = false;

function setState(next: UpdateState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function subscribeToUpdates(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getUpdateState(): UpdateState {
  return state;
}

/** Tell the waiting worker to take over. Only ever called after user confirmation. */
export function applyUpdate(): void {
  waitingWorker?.postMessage('skip-waiting');
}

function watch(registration: ServiceWorkerRegistration): void {
  if (registration.waiting !== null) {
    waitingWorker = registration.waiting;
    setState({ kind: 'available' });
  }
  registration.addEventListener('updatefound', () => {
    const installing = registration.installing;
    if (installing === null) return;
    installing.addEventListener('statechange', () => {
      if (installing.state === 'installed' && registration.waiting !== null) {
        waitingWorker = registration.waiting;
        setState({ kind: 'available' });
      }
    });
  });
}

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // A new worker took over — reload once to run under it. Guarded because the
    // browser can fire this event more than once.
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker
    .register('/sw.js')
    .then(watch)
    .catch((error: unknown) => {
      console.error('Service worker registration failed:', error);
    });
}
