import { useEffect, useState } from 'react';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';
import { registerServiceWorker } from '../pwa/register.js';
import { startWarming } from '../pwa/warm-status.js';
import { About } from './About.js';
import { Changelog } from './Changelog.js';
import { ChartView } from './ChartView.js';
import { People } from './People.js';
import { PersonForm } from './PersonForm.js';
import { PwaStatus } from './PwaStatus.js';
import { parseRoute } from './route.js';
import { SharedChartView } from './SharedChartView.js';
import { StatusBar } from './StatusBar.js';
import { StoreProvider, useStoreStatus } from './store-context.js';
import { ThemeToggle } from './ThemeToggle.js';
import { TimePlace } from './TimePlace.js';
import { APP_VERSION } from '../version.js';

/**
 * The routes that need the local store, wrapped in the one place that opens it.
 *
 * Opened here rather than at the app root so a visitor reading /about never touches
 * IndexedDB — and so a browser that refuses it (private mode, storage disabled) breaks
 * exactly one part of the app instead of the whole shell. The failure is rendered:
 * falling back to memory would lose everything typed, silently, at the next reload.
 */
function Stored({ children }: { children: React.ReactNode }): React.JSX.Element {
  const status = useStoreStatus();

  if (status.kind === 'opening') {
    return (
      <main className="shell">
        <p className="status">Opening your local data…</p>
      </main>
    );
  }

  if (status.kind === 'failed') {
    return (
      <main className="shell">
        <p className="back">
          <a href="#/">&larr; Back</a>
        </p>
        <h1>No local storage</h1>
        <p className="warning" role="alert">
          Your data is stored in this browser, and this browser will not let us open it. {status.message}
        </p>
        <p>
          Private-browsing windows and blocked site data are the usual causes. Nothing has been lost &mdash; anything
          saved earlier is still there once storage is available again. The <a href="#/time">when-and-where panel</a>{' '}
          needs no storage and still works.
        </p>
      </main>
    );
  }

  return (
    <StoreProvider store={status.store}>
      {children}
      {/* Inside the provider and after the screen: every route that shows the user's data
          gets the same answer to "does this exist anywhere but here?", in the same place. */}
      <StatusBar />
    </StoreProvider>
  );
}

/**
 * Application shell.
 *
 * Deliberately thin: its job is routing and proving the boundaries hold — worker, CSP,
 * version, AGPL obligations. Hash routing rather than a router library: the app is a
 * handful of screens, and a hash keeps every URL shareable as a plain static file.
 */
export function App(): React.JSX.Element {
  const [route, setRoute] = useState(() => window.location.hash);
  const [engineStatus, setEngineStatus] = useState<string>('Loading ephemeris…');
  const [seVersion, setSeVersion] = useState<string>();

  useEffect(() => {
    const onHashChange = (): void => {
      setRoute(window.location.hash);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);

  useEffect(() => {
    const engine = new WorkerEphemerisProvider();
    // A mutable holder rather than a `let`: TypeScript narrows a closed-over
    // boolean to its initial literal, which makes the guards below look dead.
    const effect = { cancelled: false };

    void (async () => {
      try {
        await engine.initialize();
        const version = await engine.version();
        if (!effect.cancelled) {
          setSeVersion(version);
          setEngineStatus('ready');
        }
      } catch (error) {
        // Shown rather than logged. A silent ephemeris failure is precisely the
        // bug class this project is built to avoid.
        if (!effect.cancelled) setEngineStatus(error instanceof Error ? error.message : String(error));
      }
    })();

    return () => {
      effect.cancelled = true;
      void engine.dispose();
    };
  }, []);

  useEffect(() => {
    // Dev mode only, never registered: a service worker caching `npm run dev`'s
    // requests would fight Vite's HMR, which serves the same paths differently
    // on every reload.
    if (!import.meta.env.PROD) return;
    registerServiceWorker();
    startWarming();
  }, []);

  const parsed = parseRoute(route);
  const screen = renderScreen(parsed, engineStatus, seVersion);

  return (
    <>
      {screen}
      <ThemeToggle />
      <PwaStatus />
    </>
  );
}

function renderScreen(
  parsed: ReturnType<typeof parseRoute>,
  engineStatus: string,
  seVersion: string | undefined,
): React.JSX.Element {
  if (parsed.kind === 'about') return <About seVersion={seVersion} />;
  if (parsed.kind === 'changelog') return <Changelog />;
  if (parsed.kind === 'time') return <TimePlace />;
  if (parsed.kind === 'shared') return <SharedChartView />;
  if (parsed.kind === 'people') {
    return (
      <Stored>
        <People />
      </Stored>
    );
  }
  if (parsed.kind === 'person') {
    return (
      <Stored>
        {/* Keyed on the id so navigating from one person to another remounts the form
            rather than showing the previous person's draft under a new name. */}
        <PersonForm key={parsed.personId} personId={parsed.personId} />
      </Stored>
    );
  }
  if (parsed.kind === 'chart') {
    return (
      <Stored>
        <ChartView key={parsed.personId} personId={parsed.personId} />
      </Stored>
    );
  }

  return (
    <main className="shell">
      <h1>Astraya</h1>
      <p className="tagline">Astrological charts, calculated properly.</p>

      <section aria-live="polite">
        {engineStatus === 'ready' ? (
          <p className="status" data-state="ready">
            Swiss Ephemeris <strong>{seVersion}</strong> loaded.
          </p>
        ) : (
          <p className="status">{engineStatus}</p>
        )}
      </section>

      <h2>Start here</h2>
      <p>
        <a href="#/people">People</a> holds the birth records on this device. Everything is stored in this browser and
        works with no network; signing in to sync across devices comes later and stays optional.
      </p>
      <p>
        <a href="#/time">When and where</a> resolves a birth record to a UTC offset and shows how it decided &mdash; the
        step where charts most often go quietly wrong.
      </p>

      <footer>
        {/* The version itself is the changelog link: clicking a version to see
            what changed in it is the behaviour people expect. */}
        <a href="#/changelog">Version {APP_VERSION}</a> &middot; <a href="#/about">about &amp; licence</a>
      </footer>
    </main>
  );
}
