/**
 * Which store is open, driven by who is signed in — the one thing `store-context.tsx`
 * itself doesn't decide. Also owns the sync engine's lifecycle (it exists only while
 * signed in) and the one-time "adopt this device's anonymous data" prompt (#109).
 */
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { openStore } from '../store/store.js';
import { exchangeOidcCode, login, logout, me, setup as apiSetup } from '../sync/auth-client.js';
import { createSyncEngine, pushRecords } from '../sync/engine.js';
import { consumeOidcCallback } from './oidc-pkce.js';
import { IS_DEMO_MODE } from '../demo-mode.js';
import type { AuthUser } from '../sync/auth-client.js';
import type { SyncEngine } from '../sync/engine.js';
import type { OpRecord } from '../store/ops.js';
import type { Store } from '../store/store.js';

/** Cached so an offline reload can open the right per-account database instead of the anonymous one. */
const LAST_USER_KEY = 'astraya:lastUserId';

export type StoreStatus =
  | { readonly kind: 'opening' }
  | { readonly kind: 'ready'; readonly store: Store }
  | { readonly kind: 'failed'; readonly message: string };

/** Shown once, ever, per device — see `resolveAdoption`. */
export interface AdoptionPrompt {
  readonly recordCount: number;
}

interface SessionContextValue {
  readonly status: StoreStatus;
  readonly user: AuthUser | undefined;
  readonly engine: SyncEngine | undefined;
  readonly adoption: AdoptionPrompt | undefined;
  readonly signIn: (username: string, password: string) => Promise<void>;
  readonly setup: (token: string, username: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly resolveAdoption: (accept: boolean) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

function accountDbName(userId: string): string {
  return `astraya-user-${userId}`;
}

/**
 * Deletes an account's local database (#327) — signing out never does this on its own
 * (that would be a data-loss bug for the ordinary "sign out and back in on my own laptop"
 * case), but leaves the encrypted-at-rest-on-server data sitting unencrypted in this
 * browser's IndexedDB indefinitely, which is a real privacy gap on a shared device. This
 * is exposed as a separate, explicit action (`AccountPanel.tsx`) offered only once signed
 * out of that account, never while its store is the one currently open.
 */
export function removeAccountData(userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(accountDbName(userId));
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(request.error ?? new Error('Failed to remove this account’s data from this device.'));
    };
    request.onblocked = () => {
      reject(new Error('This account’s data is still open elsewhere and could not be removed.'));
    };
  });
}

async function openAccountStore(
  user: AuthUser,
  createEngine: boolean,
  onUnauthorized: () => void,
): Promise<{ store: Store; engine: SyncEngine | undefined }> {
  const store = await openStore({ name: accountDbName(user.id) });
  const engine = createEngine ? await createSyncEngine({ store, onUnauthorized }) : undefined;
  return { store, engine };
}

export function SessionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = useState<StoreStatus>({ kind: 'opening' });
  const [user, setUser] = useState<AuthUser>();
  const [engine, setEngine] = useState<SyncEngine>();
  const [adoption, setAdoption] = useState<AdoptionPrompt>();

  // Refs, not state: `signIn`/`signOut`/the `online` retry below all need the *current*
  // store/engine synchronously, including inside async flows a re-render doesn't wait for.
  const storeRef = useRef<Store | undefined>(undefined);
  const engineRef = useRef<SyncEngine | undefined>(undefined);
  const pendingAdoptionRef = useRef<{ anonymousStore: Store; user: AuthUser } | undefined>(undefined);
  // Which account's store is left open, unattended, after `handleUnauthorized` below — read by
  // `signIn` so re-authenticating as that same account resumes it instead of misreading an
  // authenticated account's own store as the anonymous one adoption expects.
  const orphanedUserIdRef = useRef<string | undefined>(undefined);

  /**
   * The server no longer honours this device's session (#106) — forget the account locally.
   * The store is closed, not just orphaned from `user`/`engine` state (#314): leaving it open
   * and writable with no user signed in would mean every screen under this provider keeps
   * reading and writing that account's database, which is exactly the cross-account data-bleed
   * ADR 0002 calls out as this app's worst failure mode (e.g. a session expiring server-side
   * on a shared device left open, or a later re-authentication as a *different* account
   * resuming into a store someone else touched while it was ownerless). The data itself is
   * untouched on disk, so signing back in as the same user (the `orphanedUserIdRef` branch in
   * `completeSignIn`, below) reopens this same database and resumes syncing it, rather than
   * the account looking like it never existed on this device. `userId` is bound at the call
   * site rather than read from the `user` state closure, since the callback is handed to a
   * sync engine at creation time and outlives whatever render created it.
   */
  function handleUnauthorized(userId: string): void {
    orphanedUserIdRef.current = userId;
    engineRef.current?.close();
    engineRef.current = undefined;
    storeRef.current?.close();
    storeRef.current = undefined;
    setEngine(undefined);
    setUser(undefined);
    // Not `{ kind: 'failed' }`: this is recoverable by signing back in, and `'opening'` is
    // the state every screen already renders as "no writable store yet" — reusing it means
    // this doesn't need its own UI.
    setStatus({ kind: 'opening' });
  }

  useEffect(() => {
    // A plain `let` narrows to its initial literal across the `await`s below, hiding that the
    // cleanup function can flip it concurrently — same shape as `consumeRerunRequest` in
    // `sync/engine.ts`. Reading it back through a function with its own declared return type
    // sidesteps that narrowing.
    let cancelled = false;
    function isCancelled(): boolean {
      return cancelled;
    }

    void (async () => {
      // Demo mode (#73) has no server at all — not even one to 401 against —
      // so it skips the OIDC/`me()` dance entirely and opens the anonymous
      // store directly, exactly as the ordinary signed-out path below does.
      if (IS_DEMO_MODE) {
        const anonymous = await openStore();
        if (isCancelled()) {
          anonymous.close();
          return;
        }
        storeRef.current = anonymous;
        setStatus({ kind: 'ready', store: anonymous });
        return;
      }

      // Checked first, before anything else reads the URL: a completed Authentik
      // redirect (#75) is exchanged and driven through the exact same adoption
      // dance as an interactive password sign-in (`completeSignIn`), never a
      // separate path. A failed/stale exchange (e.g. a reloaded callback URL,
      // whose one-time code `consumeOidcCallback` already discarded) falls
      // through to the ordinary `me()` check below rather than failing boot.
      const oidcParams = consumeOidcCallback();
      if (oidcParams !== undefined) {
        try {
          const oidcUser = await exchangeOidcCode(oidcParams);
          if (isCancelled()) return;
          const anonymous = await openStore();
          if (isCancelled()) {
            anonymous.close();
            return;
          }
          storeRef.current = anonymous;
          setStatus({ kind: 'ready', store: anonymous });
          await completeSignIn(oidcUser);
          return;
        } catch {
          /* fall through to the normal signed-in/signed-out check below */
        }
      }

      let authUser: AuthUser | undefined;
      let offline = false;
      try {
        authUser = await me();
      } catch {
        offline = true;
      }
      if (isCancelled()) return;

      try {
        if (!offline && authUser === undefined) {
          localStorage.removeItem(LAST_USER_KEY);
          const anonymous = await openStore();
          if (isCancelled()) {
            anonymous.close();
            return;
          }
          storeRef.current = anonymous;
          setStatus({ kind: 'ready', store: anonymous });
        } else if (!offline && authUser !== undefined) {
          localStorage.setItem(LAST_USER_KEY, authUser.id);
          const opened = await openAccountStore(authUser, true, () => {
            handleUnauthorized(authUser.id);
          });
          if (isCancelled()) {
            opened.engine?.close();
            opened.store.close();
            return;
          }
          storeRef.current = opened.store;
          engineRef.current = opened.engine;
          setStatus({ kind: 'ready', store: opened.store });
          setUser(authUser);
          setEngine(opened.engine);
        } else {
          // Offline at boot: can't tell signed-in from signed-out, so fall back to
          // whichever database was open last time rather than guessing wrong in either
          // direction. No sync engine until `online` fires and `me()` can be retried.
          const cachedId = localStorage.getItem(LAST_USER_KEY);
          const store = await openStore(cachedId === null ? {} : { name: accountDbName(cachedId) });
          if (isCancelled()) {
            store.close();
            return;
          }
          storeRef.current = store;
          setStatus({ kind: 'ready', store });
        }
      } catch (error) {
        if (!isCancelled()) {
          setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();

    return () => {
      cancelled = true;
      engineRef.current?.close();
      storeRef.current?.close();
    };
  }, []);

  useEffect(() => {
    // Upgrades the offline-boot fallback above into a confirmed session once connectivity
    // returns, without reopening the store it already guessed correctly.
    function retryIdentity(): void {
      if (user !== undefined || engineRef.current !== undefined) return;
      const cachedId = localStorage.getItem(LAST_USER_KEY);
      const openStoreNow = storeRef.current;
      if (cachedId === null || openStoreNow === undefined) return;
      void me()
        .then(async (authUser) => {
          if (authUser?.id !== cachedId) return;
          const syncEngine = await createSyncEngine({
            store: openStoreNow,
            onUnauthorized: () => {
              handleUnauthorized(authUser.id);
            },
          });
          engineRef.current = syncEngine;
          setEngine(syncEngine);
          setUser(authUser);
        })
        .catch(() => undefined);
    }

    window.addEventListener('online', retryIdentity);
    return () => {
      window.removeEventListener('online', retryIdentity);
    };
  }, [user]);

  async function switchTo(authUser: AuthUser, createEngine: boolean, adopted: readonly OpRecord[]): Promise<void> {
    // The engine is created only after `receive` resolves (#321), not folded into a single
    // `openAccountStore(..., true, ...)` call: created any earlier, it could start its own
    // first push/pull tick against a store that hasn't yet folded in the adopted anonymous
    // records, racing the adoption merge — mirrors the two-step shape `completeSignIn`'s
    // orphaned-account branch already uses.
    const opened = await openAccountStore(authUser, false, () => {
      handleUnauthorized(authUser.id);
    });
    if (adopted.length > 0) await opened.store.receive(adopted);
    const engine = createEngine
      ? await createSyncEngine({
          store: opened.store,
          onUnauthorized: () => {
            handleUnauthorized(authUser.id);
          },
        })
      : undefined;
    engineRef.current?.close();
    storeRef.current?.close();
    storeRef.current = opened.store;
    engineRef.current = engine;
    setStatus({ kind: 'ready', store: opened.store });
    setUser(authUser);
    setEngine(engine);
  }

  /**
   * Everything a sign-in does once an `AuthUser` is in hand, regardless of how it was
   * obtained — a password (`signIn`) or a completed OIDC exchange (the mount effect's
   * callback handling, below). Requires `storeRef.current` to already be the anonymous
   * store, so the adoption check below has something to check.
   */
  async function completeSignIn(authUser: AuthUser): Promise<void> {
    localStorage.setItem(LAST_USER_KEY, authUser.id);

    // A prior sync rejection (#106) leaves this exact account signed out with its store
    // already closed (`handleUnauthorized`, #314) — reopen the same database and resume
    // syncing it, rather than running the anonymous-data adoption flow below against an
    // authenticated account's own data.
    if (orphanedUserIdRef.current !== undefined) {
      const orphanedId = orphanedUserIdRef.current;
      orphanedUserIdRef.current = undefined;
      if (orphanedId === authUser.id) {
        const store = await openStore({ name: accountDbName(orphanedId) });
        const syncEngine = await createSyncEngine({
          store,
          onUnauthorized: () => {
            handleUnauthorized(authUser.id);
          },
        });
        storeRef.current = store;
        engineRef.current = syncEngine;
        setStatus({ kind: 'ready', store });
        setEngine(syncEngine);
        setUser(authUser);
        return;
      }
      // A different account signing in: `handleUnauthorized` already closed the orphaned
      // store, so there is nothing to adopt from it — fall through to a normal switch.
      await switchTo(authUser, true, []);
      return;
    }

    // Only reachable while signed out, which is only ever rendered once a store — the
    // anonymous one, since no account is signed in yet — is already open.
    const anonymousStore = storeRef.current;
    if (anonymousStore === undefined) throw new Error('signIn was called before any store was open');

    const alreadyDecided = await anonymousStore.getAdoptionDecision();
    const outgoing = alreadyDecided === undefined ? anonymousStore.outgoing() : [];

    if (outgoing.length === 0) {
      if (alreadyDecided === undefined) await anonymousStore.setAdoptionDecision('declined');
      await switchTo(authUser, true, []);
      return;
    }

    pendingAdoptionRef.current = { anonymousStore, user: authUser };
    setAdoption({ recordCount: outgoing.length });
  }

  async function signIn(username: string, password: string): Promise<void> {
    const authUser = await login(username, password);
    await completeSignIn(authUser);
  }

  async function setup(token: string, username: string, password: string): Promise<void> {
    const authUser = await apiSetup(token, username, password);
    await completeSignIn(authUser);
  }

  async function resolveAdoption(accept: boolean): Promise<void> {
    const pending = pendingAdoptionRef.current;
    if (pending === undefined) return;

    const outgoing = pending.anonymousStore.outgoing();
    if (accept) {
      // The prompt is only cleared once the push actually lands (#321): clearing it first
      // and then having `pushRecords` throw (a network failure mid-adoption) would leave
      // the user with no record anything was ever pending and no way to retry — the
      // records are still sitting in the anonymous store, but nothing in the UI points
      // back at this flow. Leaving `pendingAdoptionRef`/`adoption` set lets the same
      // "accept" action be retried, and the caller sees the thrown error.
      await pushRecords(outgoing);
      await pending.anonymousStore.setAdoptionDecision(`user:${pending.user.id}`);
      pendingAdoptionRef.current = undefined;
      setAdoption(undefined);
      await switchTo(pending.user, true, outgoing);
    } else {
      pendingAdoptionRef.current = undefined;
      setAdoption(undefined);
      await pending.anonymousStore.setAdoptionDecision('declined');
      await switchTo(pending.user, true, []);
    }
  }

  async function signOut(): Promise<void> {
    const { endSessionUrl } = await logout();
    localStorage.removeItem(LAST_USER_KEY);
    const anonymous = await openStore();
    engineRef.current?.close();
    storeRef.current?.close();
    storeRef.current = anonymous;
    engineRef.current = undefined;
    setStatus({ kind: 'ready', store: anonymous });
    setUser(undefined);
    setEngine(undefined);
    // Only an OIDC-derived session gets one back (#77) — a real top-level
    // navigation, not a fetch, since ending Authentik's own browser session
    // requires the browser to actually visit its end_session endpoint.
    if (endSessionUrl !== undefined) window.location.href = endSessionUrl;
  }

  const value: SessionContextValue = { status, user, engine, adoption, signIn, setup, signOut, resolveAdoption };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function useSessionContext(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === undefined) throw new Error('useSession was called outside a SessionProvider');
  return value;
}

export function useStoreStatus(): StoreStatus {
  return useSessionContext().status;
}

export function useSyncEngine(): SyncEngine | undefined {
  return useSessionContext().engine;
}

export function useSession(): {
  user: AuthUser | undefined;
  adoption: AdoptionPrompt | undefined;
  signIn: (username: string, password: string) => Promise<void>;
  setup: (token: string, username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resolveAdoption: (accept: boolean) => Promise<void>;
} {
  const { user, adoption, signIn, setup, signOut, resolveAdoption } = useSessionContext();
  return { user, adoption, signIn, setup, signOut, resolveAdoption };
}
