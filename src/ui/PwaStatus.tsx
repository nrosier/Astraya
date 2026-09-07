/**
 * Two independent PWA signals the visitor might need to see (#99, #100):
 *
 *  - A new service worker is installed and waiting — surfaced as a banner with an
 *    explicit action, never applied on its own, so a visitor mid-form never has
 *    the running app swapped out from under them.
 *  - The ephemeris cache is warming, or failed to. Warming is silent when it
 *    succeeds; a failure is shown, since it means the *next* offline session
 *    will be missing an asset it needs.
 *
 * Present on every screen, unlike `StatusBar` — an update or a warm failure
 * matters even on `/about`, which never opens the local store.
 */
import { useSyncExternalStore } from 'react';
import { applyUpdate, getUpdateState, subscribeToUpdates } from '../pwa/register.js';
import { getWarmState, subscribeToWarmState } from '../pwa/warm-status.js';

function formatMebibytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PwaStatus(): React.JSX.Element | null {
  const update = useSyncExternalStore(subscribeToUpdates, getUpdateState);
  const warm = useSyncExternalStore(subscribeToWarmState, getWarmState);

  if (update.kind === 'none' && warm.kind !== 'failed' && warm.kind !== 'warming') return null;

  return (
    <div className="pwastatus">
      {update.kind === 'available' && (
        <p className="pwastatus-update" role="status">
          An updated version is ready. <button onClick={applyUpdate}>Reload to update</button>
        </p>
      )}
      {warm.kind === 'warming' && (
        <p className="pwastatus-warm">
          Preparing offline use: {formatMebibytes(warm.loadedBytes)} of {formatMebibytes(warm.totalBytes)}.
        </p>
      )}
      {warm.kind === 'failed' && (
        <p className="warning" role="alert">
          Could not prepare this device for offline use: {warm.message}
        </p>
      )}
    </div>
  );
}
