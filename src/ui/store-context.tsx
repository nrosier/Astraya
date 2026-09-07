/**
 * React's view of the store.
 *
 * The store is a plain object with a `subscribe` — deliberately not a React thing — so this
 * file is the whole of the adapter. `useSyncExternalStore` is the right hook for it: it
 * subscribes, reads a snapshot, and gets tearing right during concurrent rendering, which a
 * `useState` plus `useEffect` pair does not.
 *
 * Opening the store is asynchronous and can fail — a browser in private mode may refuse
 * IndexedDB outright. That failure is rendered, never swallowed: an app that silently falls
 * back to holding data in memory would lose everything the user typed at the next reload
 * without ever saying so.
 */
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { openStore } from '../store/store.js';
import type { State } from '../store/fold.js';
import type { Store } from '../store/store.js';

const StoreContext = createContext<Store | undefined>(undefined);

export type StoreStatus =
  | { readonly kind: 'opening' }
  | { readonly kind: 'ready'; readonly store: Store }
  | { readonly kind: 'failed'; readonly message: string };

export function useStoreStatus(): StoreStatus {
  const [status, setStatus] = useState<StoreStatus>({ kind: 'opening' });

  useEffect(() => {
    // A mutable holder rather than a `let`: TypeScript narrows a closed-over boolean to its
    // initial literal, which makes the guards below look dead. Same pattern as App.
    const effect = { cancelled: false, store: undefined as Store | undefined };

    void (async () => {
      try {
        const store = await openStore();
        effect.store = store;
        if (effect.cancelled) store.close();
        else setStatus({ kind: 'ready', store });
      } catch (error) {
        if (!effect.cancelled) {
          setStatus({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();

    return () => {
      effect.cancelled = true;
      effect.store?.close();
    };
  }, []);

  return status;
}

export function StoreProvider({ store, children }: { store: Store; children: React.ReactNode }): React.JSX.Element {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  // Thrown rather than returned as undefined: a component reading the store outside the
  // provider is a wiring mistake, and every caller would otherwise need a branch for a
  // state that only a bug can produce.
  if (store === undefined) throw new Error('useStore was called outside a StoreProvider');
  return store;
}

/**
 * The current fold.
 *
 * `store.state` is replaced wholesale on every change and never mutated, which is what makes
 * it a valid snapshot: React compares by identity, so an in-place update would look like no
 * change at all.
 */
export function useStoreState(): State {
  const store = useStore();
  return useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.state,
  );
}
