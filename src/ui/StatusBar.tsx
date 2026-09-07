/**
 * The status line (#101).
 *
 * Present on every screen that shows the user's data, because the question it answers —
 * "does this exist anywhere but here?" — is not one the user should have to go looking for.
 *
 * All the wording and the escalation live in `status.ts`, tested there. This is the wiring:
 * where `online` comes from, what counts as pending, and how much of it is shown at once.
 */
import { useEffect, useState } from 'react';
import { describeStatus, type SyncState } from './status.js';
import { useStore, useStoreState } from './store-context.js';

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

export function StatusBar(): React.JSX.Element {
  const store = useStore();
  // Subscribed for the side effect of re-rendering: the pending count comes from the log,
  // which changes on every mutation, and the store notifies rather than being watched.
  useStoreState();
  const online = useOnline();

  // Sync arrives in M8. `off` is not a placeholder — it is the true state of an app with no
  // account, and it is the state most users will be in.
  const sync: SyncState = { kind: 'off' };
  const status = describeStatus({
    online,
    persistence: store.persistence,
    pending: store.outgoing().length,
    sync,
    // Read at render rather than ticked on a timer: nothing in the `off` state ages, and a
    // once-a-minute re-render of the whole tree to refresh a relative timestamp is a poor
    // trade. When sync lands and "synced 3 minutes ago" can go stale, that changes.
    now: Date.now(),
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
