import { useEffect, useRef, useState } from 'react';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';
import { registerServiceWorker } from '../pwa/register.js';
import { startWarming } from '../pwa/warm-status.js';
import { About } from './About.js';
import { AccountPanel } from './AccountPanel.js';
import { AdminPanel } from './AdminPanel.js';
import { Changelog } from './Changelog.js';
import { ChartView } from './ChartView.js';
import { LanguageToggle } from './LanguageToggle.js';
import { People } from './People.js';
import { PersonForm } from './PersonForm.js';
import { ProfectionsView } from './ProfectionsView.js';
import { PwaStatus } from './PwaStatus.js';
import { parseRoute } from './route.js';
import { SessionProvider, useStoreStatus } from './session-context.js';
import { SetPasswordForm } from './SetPasswordForm.js';
import { SetupForm } from './SetupForm.js';
import { SharedChartView } from './SharedChartView.js';
import { StatusBar } from './StatusBar.js';
import { StoreProvider } from './store-context.js';
import { SyncBadge } from './SyncBadge.js';
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
          gets the same answer to "does this exist anywhere but here?", in the same place.
          Sign-in status and the global sync badge live outside `Stored` now (rendered by
          `App` itself) since they don't need the store, only the session. */}
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
  const isFirstRoute = useRef(true);

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
    // A hash change swaps `<main>`'s entire contents for another screen's, but doesn't
    // reload the document — so unlike a real page load, nothing tells a screen-reader
    // user that navigation happened or where they landed; focus is simply abandoned on
    // whatever DOM node the previous screen's now-removed element used to be, which
    // browsers resolve to `<body>` (#69). Move focus to the new screen's `<h1>` on every
    // navigation after the first, giving keyboard/AT users the same "you're on a new
    // page" signal a full page load gives for free. Skipped on the initial mount: focus
    // there should stay wherever the browser already put it.
    if (isFirstRoute.current) {
      isFirstRoute.current = false;
      return;
    }
    const heading = document.querySelector<HTMLElement>('main.shell h1');
    if (heading === null) return;
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
    heading.focus();
  }, [route]);

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
    // Wraps the whole shell, not just `Stored`: which store is open follows who is signed
    // in, and that has to survive navigating between routes that each mount their own
    // `Stored` — otherwise every navigation would reopen the database and restart sync.
    //
    // Account and sync status are global, not tied to any one screen (#137): sign-in state
    // belongs top-left on every route including the landing page, where nothing showed it
    // before; sync status, the language choice and the theme toggle sit together top-right
    // as the app's persistent "how this looks and where my data is" controls.
    <SessionProvider>
      {/* Ordered before `screen` so tab order matches the fixed top-of-viewport
          position these render at (#69) — a keyboard user reaches them first,
          same as sighted users see them first. */}
      <div className="topbar-left">
        <AccountPanel />
      </div>
      <div className="topbar-right">
        <SyncBadge />
        <LanguageToggle />
        <ThemeToggle />
      </div>
      {screen}
      <PwaStatus />
    </SessionProvider>
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
  if (parsed.kind === 'set-password') return <SetPasswordForm />;
  if (parsed.kind === 'setup') return <SetupForm />;
  if (parsed.kind === 'admin') {
    return (
      <Stored>
        <AdminPanel />
      </Stored>
    );
  }
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
  if (parsed.kind === 'profections') {
    return (
      <Stored>
        <ProfectionsView key={parsed.personId} personId={parsed.personId} />
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
