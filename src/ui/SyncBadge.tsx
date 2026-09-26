/**
 * The always-visible answer to "where does my data live, and is it safe?" (#101, #230).
 *
 * A collapsed badge by default — the label and tone alone answer "am I synced" without
 * taking any space — that expands into `describeStatus()`'s full explanation on click
 * (#250). This replaces the old `StatusBar`, which put that same explanation in a footer
 * `<details>` at the bottom of the page: useful the first time, invisible every time after,
 * since nothing above the fold ever pointed at it. Anchoring the disclosure to the badge
 * itself — the thing the user is already looking at when they wonder about sync — means
 * the "Local only" warning is discoverable from every screen, not just the ones long enough
 * to scroll past.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useMessages } from './messages.js';
import { useSession, useSyncEngine } from './session-context.js';
import { describeStatus, type SyncState } from './status.js';
import { statusMessages } from './status.messages.js';
import { syncBadgeMessages } from './SyncBadge.messages.js';
import { useOptionalStore } from './store-context.js';
import type { Persistence } from '../store/persist.js';

const OFF_STATUS: SyncState = { kind: 'off' };

// `SyncBadge` is mounted on every route (`App.tsx`), including the handful — /about,
// /changelog, /shared, /set-password, /setup — that never open a store. There is no real
// persistence answer for those, and claiming `'persisted'` would be the exact reassuring
// lie this file exists to avoid; assuming the more cautious `'evictable'` instead only ever
// makes the badge say "back this up" when there may be nothing to back up, never the reverse.
const UNKNOWN_PERSISTENCE: Persistence = { state: 'evictable' };

const POPOVER_ID = 'syncbadge-popover';

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

export function SyncBadge(): React.JSX.Element {
  const engine = useSyncEngine();
  const store = useOptionalStore();
  const { user } = useSession();
  const online = useOnline();
  const sync = useSyncState();
  const now = useNow(30_000);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const t = useMessages(syncBadgeMessages);
  const statusT = useMessages(statusMessages);

  const close = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    // Otherwise the popover floats open over whatever screen the user navigates to next —
    // both a stray dialog left open for no reason, and (since it's positioned absolutely)
    // something that can sit on top of and intercept clicks on the new page's content.
    if (!open) return;
    const onHashChange = (): void => {
      close();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [open]);

  const status = describeStatus(
    {
      online,
      persistence: store?.persistence ?? UNKNOWN_PERSISTENCE,
      pending: engine?.pending() ?? store?.outgoing().length ?? 0,
      quarantined: engine?.quarantined() ?? 0,
      sync,
      now,
    },
    statusT,
  );

  return (
    <div
      className="syncbadge"
      data-tone={status.tone === 'warn' ? 'warn' : 'ok'}
      onKeyDown={(event) => {
        // On the wrapper rather than the popover itself: the trigger button keeps focus
        // after opening it (there's nothing inside the popover worth moving focus to — it's
        // a read-only explanation, not a form), so a handler scoped to the popover would
        // never see the keypress.
        if (open && event.key === 'Escape') close();
      }}
    >
      <span className="syncbadge-text">
        <button
          ref={triggerRef}
          type="button"
          className="syncbadge-label"
          aria-expanded={open}
          aria-controls={POPOVER_ID}
          onClick={() => {
            setOpen((was) => !was);
          }}
        >
          {status.label}
        </button>
        {user !== undefined && <span className="syncbadge-user">{t.loggedInAs(user.username)}</span>}
      </span>
      {engine !== undefined && (
        <button
          type="button"
          className="syncbadge-sync"
          disabled={sync.kind === 'syncing'}
          title={t.syncNow}
          aria-label={t.syncNow}
          onClick={() => {
            engine.syncNow();
          }}
        >
          ⟳
        </button>
      )}
      {open && (
        <div id={POPOVER_ID} className="syncbadge-popover" role="status" aria-label={status.label}>
          <p>
            {status.detail}
            {status.action !== undefined && (
              <>
                {' '}
                <a href={status.action.href}>{status.action.text}</a>.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
