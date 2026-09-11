/**
 * The status line (#101).
 *
 * Present on every screen that shows the user's data, because the question it answers —
 * "does this exist anywhere but here?" — is not one the user should have to go looking for.
 *
 * All the wording and the escalation live in `status.ts`, tested there. This is the wiring:
 * where `online` comes from, what counts as pending, and how much of it is shown at once.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSyncEngine } from './session-context.js';
import { describeStatus, type SyncState } from './status.js';
import { useStore, useStoreState } from './store-context.js';

// Module-level, not inline in `getSnapshot` below: `useSyncExternalStore` compares snapshots
// by reference, so a fresh `{ kind: 'off' }` literal on every call looks like a perpetual
// change and spins the component into React's "Maximum update depth exceeded" error.
const OFF_STATUS: SyncState = { kind: 'off' };

/** Live sync status, re-rendering on every change the engine reports. `off` with no engine. */
function useSyncState(): SyncState {
  const engine = useSyncEngine();
  const subscribe = (onChange: () => void): (() => void) =>
    engine === undefined ? () => undefined : engine.subscribe(onChange);
  return useSyncExternalStore(subscribe, () => engine?.status ?? OFF_STATUS);
}

/**
 * `navigator.onLine`, kept current.
 *
 * Worth remembering how weak this signal is: `true` means the machine has a network
 * interface with a route, not that anything is reachable. It is enough to explain a failure
 * the user is already seeing, and it is never used to *decide* whether to try — a sync
 * attempt is the only real test of connectivity.
 */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const update = (): void => {
      setOnline(navigator.onLine);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    // Re-read on mount: the events fire only on change, so a tab restored from the back-
    // forward cache would otherwise show whatever was true when it was frozen.
    update();
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return online;
}

/** Kept fresh so "synced 3 minutes ago" and the failing-since-breakfast escalation age correctly while the tab sits open. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(interval);
    };
  }, [intervalMs]);

  return now;
}

export function StatusBar(): React.JSX.Element {
  const store = useStore();
  // Subscribed for the side effect of re-rendering: the pending count comes from the log,
  // which changes on every mutation, and the store notifies rather than being watched.
  useStoreState();
  const online = useOnline();
  const engine = useSyncEngine();
  const sync = useSyncState();
  const now = useNow(30_000);

  const status = describeStatus({
    online,
    persistence: store.persistence,
    // No engine means signed out: everything in the log is unsent to anywhere, which is
    // exactly what `outgoing()` with no cursor already means.
    pending: engine?.pending() ?? store.outgoing().length,
    sync,
    now,
  });

  return (
    <div className="statusbar" data-tone={status.tone}>
      <details open={status.tone === 'warn'}>
        <summary>
          <span className="dot" aria-hidden="true" />
          {status.label}
        </summary>
        <p role="status">
          {status.detail}
          {status.action !== undefined && (
            <>
              {' '}
              <a href={status.action.href}>{status.action.text}</a>.
            </>
          )}
        </p>
      </details>
    </div>
  );
}
