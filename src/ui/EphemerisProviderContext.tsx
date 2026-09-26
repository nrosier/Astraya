/**
 * The one ephemeris worker for the whole app (#315).
 *
 * Every chart-type view used to construct its own `WorkerEphemerisProvider` on
 * mount and dispose it on unmount — 11 independent sites, each paying the fixed
 * cost of recompiling the WASM module and reloading every ephemeris data file
 * from scratch (`SwissEphemerisEngine#doInitialize`) on every navigation between
 * chart screens for the same person. Mounted once at the app root (`App.tsx`),
 * for the app's whole lifetime, so navigating between chart screens reuses the
 * same worker instead of respawning it.
 *
 * Safe to share: every call already carries its own zodiac/observer options
 * rather than relying on state a prior call left behind, and the worker
 * serializes requests through one promise chain, so callers from different
 * views never race each other's settings.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';
import type { EphemerisProvider } from '../ephemeris/types.js';

export interface EphemerisProviderState {
  /** `undefined` until the worker has initialized, or if it never will. */
  readonly provider: EphemerisProvider | undefined;
  /** Set once, on initialization failure. A silent ephemeris failure is precisely the bug class this project is built to avoid, so `App.tsx` surfaces this in its topbar status on every route. */
  readonly error: string | undefined;
}

const EphemerisProviderContext = createContext<EphemerisProviderState | undefined>(undefined);

export function EphemerisProviderProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<EphemerisProviderState>({ provider: undefined, error: undefined });

  useEffect(() => {
    const provider = new WorkerEphemerisProvider();
    const effect = { cancelled: false };
    void provider
      .initialize()
      .then(() => {
        if (!effect.cancelled) setState({ provider, error: undefined });
      })
      .catch((error: unknown) => {
        if (!effect.cancelled) {
          setState({ provider: undefined, error: error instanceof Error ? error.message : String(error) });
        }
      });
    return () => {
      effect.cancelled = true;
      void provider.dispose();
    };
  }, []);

  return <EphemerisProviderContext.Provider value={state}>{children}</EphemerisProviderContext.Provider>;
}

export function useEphemerisProvider(): EphemerisProviderState {
  const state = useContext(EphemerisProviderContext);
  if (state === undefined) throw new Error('useEphemerisProvider must be used within EphemerisProviderProvider');
  return state;
}
