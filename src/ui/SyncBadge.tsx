/**
 * The always-visible answer to "is my data anywhere but this device", now living in the
 * fixed top-right corner of every screen rather than only inside `Stored`'s detailed,
 * in-flow `StatusBar` — that one stays exactly where it is (it needs per-device pending-op
 * counts only `store-context.tsx` has, and its own rationale for staying in-flow rather
 * than fixed still holds), this is the compact, global companion to it.
 *
 * Deliberately simpler than `describeStatus` (`status.ts`): no persistence-eviction
 * warning, no "N changes to send" — just enough to say whether a server is reachable and
 * who, if anyone, is signed in, plus a manual "sync now" button wired to the engine's
 * `syncNow()`. `StatusBar` remains the place for the fuller explanation.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSession, useSyncEngine } from './session-context.js';
import type { SyncState } from './status.js';

/** A stable snapshot, not a fresh object literal per render — see `StatusBar.tsx`'s own `OFF_STATUS`. */
const OFF_STATUS: SyncState = { kind: 'off' };

function useSyncState(): SyncState {
  const engine = useSyncEngine();
  const subscribe = (onChange: () => void): (() => void) =>
    engine === undefined ? () => undefined : engine.subscribe(onChange);
  return useSyncExternalStore(subscribe, () => engine?.status ?? OFF_STATUS);
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const goOnline = (): void => {
      setOnline(true);
    };
    const goOffline = (): void => {
      setOnline(false);
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);
  return online;
}

function badgeLabel(sync: SyncState, online: boolean): string {
  if (sync.kind === 'failing') return online ? 'Sync failing' : 'Offline';
  if (sync.kind === 'syncing') return 'Syncing…';
  if (sync.kind === 'synced') return 'Server online';
  return 'Local only';
}

export function SyncBadge(): React.JSX.Element {
  const engine = useSyncEngine();
  const { user } = useSession();
  const online = useOnline();
  const sync = useSyncState();
  const label = badgeLabel(sync, online);

  return (
    <div className="syncbadge" data-tone={sync.kind === 'failing' ? 'warn' : 'ok'}>
      <span className="syncbadge-text">
        <span className="syncbadge-label">{label}</span>
        {user !== undefined && <span className="syncbadge-user">(logged in as: {user.username})</span>}
      </span>
      {engine !== undefined && (
        <button
          type="button"
          className="syncbadge-sync"
          disabled={sync.kind === 'syncing'}
          title="Sync now"
          aria-label="Sync now"
          onClick={() => {
            engine.syncNow();
          }}
        >
          ⟳
        </button>
      )}
    </div>
  );
}
