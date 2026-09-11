/**
 * React's view of the store.
 *
 * The store is a plain object with a `subscribe` — deliberately not a React thing — so this
 * file is the whole of the adapter. `useSyncExternalStore` is the right hook for it: it
 * subscribes, reads a snapshot, and gets tearing right during concurrent rendering, which a
 * `useState` plus `useEffect` pair does not.
 *
 * Which store to open, and opening it, live one level up in `session-context.tsx` — that
 * depends on who's signed in, which this file has no reason to know about.
 */
import { createContext, useContext, useSyncExternalStore } from 'react';
import type { State } from '../store/fold.js';
import type { Store } from '../store/store.js';

const StoreContext = createContext<Store | undefined>(undefined);

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
