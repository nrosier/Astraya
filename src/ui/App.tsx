import { useEffect, useRef, useState } from 'react';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';
import { registerServiceWorker } from '../pwa/register.js';
import { startWarming } from '../pwa/warm-status.js';
import { About } from './About.js';
import { AccountPanel } from './AccountPanel.js';
import { AdminPanel } from './AdminPanel.js';
import { appMessages } from './App.messages.js';
import { AstrocartographyView } from './AstrocartographyView.js';
import { Changelog } from './Changelog.js';
import { ChartView } from './ChartView.js';
import { CompositeView } from './CompositeView.js';
import { HarmonicView } from './HarmonicView.js';
import { LanguageToggle } from './LanguageToggle.js';
import { useMessages } from './messages.js';
import { People } from './People.js';
import { PeriodicTransitView } from './PeriodicTransitView.js';
import { PersonForm } from './PersonForm.js';
import { PersonNav } from './PersonNav.js';
import { ProfectionsView } from './ProfectionsView.js';
import { PwaStatus } from './PwaStatus.js';
import { parseRoute } from './route.js';
import { SessionProvider, useStoreStatus } from './session-context.js';
import { SetPasswordForm } from './SetPasswordForm.js';
import { SetupForm } from './SetupForm.js';
import { SharedChartView } from './SharedChartView.js';
import { sharedMessages } from './shared.messages.js';
import { StoreProvider } from './store-context.js';
import { SyncBadge } from './SyncBadge.js';
import { SynastryView } from './SynastryView.js';
import { ThemeToggle } from './ThemeToggle.js';
import { TransitView } from './TransitView.js';
import { APP_VERSION } from '../version.js';
import type { Route } from './route.js';

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
  const t = useMessages(appMessages);
  const shared = useMessages(sharedMessages);

  if (status.kind === 'opening') {
    return (
      <main className="shell">
        <p className="status">{t.openingLocalData}</p>
      </main>
    );
  }

  if (status.kind === 'failed') {
    return (
      <main className="shell">
        <p className="back">
          <a href="#/">&larr; {shared.back}</a>
        </p>
        <h1>{t.noLocalStorage}</h1>
        <p className="warning" role="alert">
          {t.noLocalStorageWarning(status.message)}
        </p>
        <p>{t.noLocalStorageHint}</p>
      </main>
    );
  }

  return <StoreProvider store={status.store}>{children}</StoreProvider>;
}

/**
 * Application shell.
 *
 * Deliberately thin: its job is routing and proving the boundaries hold — worker, CSP,
 * version, AGPL obligations. Hash routing rather than a router library: the app is a
 * handful of screens, and a hash keeps every URL shareable as a plain static file.
 */
export function App(): React.JSX.Element {
  const t = useMessages(appMessages);
  const [route, setRoute] = useState(() => window.location.hash);
  const [engineStatus, setEngineStatus] = useState<string>(t.loadingEphemeris);
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
  const screen = renderScreen(parsed, seVersion);

  return (
    // Wraps the whole shell, not just `Stored`: which store is open follows who is signed
    // in, and that has to survive navigating between routes that each mount their own
    // `Stored` — otherwise every navigation would reopen the database and restart sync.
    //
    // Account and sync status are global, not tied to any one screen (#137): both sit
    // together top-right, on every route including the landing page, as the app's
    // persistent "am I signed in, and where is my data" controls (#230) — previously
    // split across both top corners, which left sign-in state and sync status saying
    // the same thing twice in two places.
    <SessionProvider>
      {/* Ordered before `screen` so tab order matches the fixed top-of-viewport
          position these render at (#69) — a keyboard user reaches them first,
          same as sighted users see them first. `AccountPanel` sits right next to
          `SyncBadge` (#230): sign-in/out is the thing that changes the sync badge's
          state, so it belongs beside it rather than on the opposite side of the bar. */}
      <div className="topbar-right">
        {/* Only shown while loading or on failure (#234) — once ready, the ephemeris is an
            implementation detail again. A silent failure here is precisely the bug class
            this project is built to avoid, so it stays visible on every route, not just a
            landing page that no longer exists. */}
        {engineStatus !== 'ready' && <p className="status">{engineStatus}</p>}
        <SyncBadge />
        <AccountPanel />
        <LanguageToggle />
        <ThemeToggle />
      </div>
      {screen}
      <footer>
        {/* The version itself is the changelog link: clicking a version to see what changed
            in it is the behaviour people expect. Promoted here from the old landing page
            (#234) so both routes stay reachable now that the landing page is gone. */}
        <a href="#/changelog">{t.changelogLink(APP_VERSION)}</a> &middot; <a href="#/about">{t.aboutLink}</a>
      </footer>
      <PwaStatus />
    </SessionProvider>
  );
}

/** `#/` (and any unmatched hash) always lands here; it redirects straight to the people list (#234) — no auto-created person, no "last active" state, just the one obvious next step. */
function HomeRedirect(): React.JSX.Element | null {
  useEffect(() => {
    window.location.hash = '#/people';
  }, []);
  return null;
}

function renderScreen(parsed: Route, seVersion: string | undefined): React.JSX.Element {
  if (parsed.kind === 'about') return <About seVersion={seVersion} />;
  if (parsed.kind === 'changelog') return <Changelog />;
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
  if (
    parsed.kind === 'person' ||
    parsed.kind === 'chart' ||
    parsed.kind === 'profections' ||
    parsed.kind === 'transit' ||
    parsed.kind === 'synastry' ||
    parsed.kind === 'composite' ||
    parsed.kind === 'harmonic' ||
    parsed.kind === 'periodic-transit' ||
    parsed.kind === 'astrocartography'
  ) {
    return (
      <Stored>
        {/* Rendered once above whichever view is picked below (#234), rather than each of
            the nine person-scoped screens carrying its own copy of the nav chain that used
            to live inside PersonForm. */}
        <PersonNav personId={parsed.personId} route={parsed} />
        {renderPersonView(parsed)}
      </Stored>
    );
  }

  return <HomeRedirect />;
}

type PersonRoute = Extract<
  Route,
  {
    kind:
      | 'person'
      | 'chart'
      | 'profections'
      | 'transit'
      | 'synastry'
      | 'composite'
      | 'harmonic'
      | 'periodic-transit'
      | 'astrocartography';
  }
>;

/** Which chart-type view to show for a person-scoped route, keyed on the id so navigating from one person to another remounts the view rather than showing the previous person's data under a new name. */
function renderPersonView(parsed: PersonRoute): React.JSX.Element {
  if (parsed.kind === 'person') return <PersonForm key={parsed.personId} personId={parsed.personId} />;
  if (parsed.kind === 'chart') return <ChartView key={parsed.personId} personId={parsed.personId} />;
  if (parsed.kind === 'profections') return <ProfectionsView key={parsed.personId} personId={parsed.personId} />;
  if (parsed.kind === 'transit') return <TransitView key={parsed.personId} personId={parsed.personId} />;
  if (parsed.kind === 'synastry') return <SynastryView key={parsed.personId} personId={parsed.personId} />;
  if (parsed.kind === 'composite') return <CompositeView key={parsed.personId} personId={parsed.personId} />;
  if (parsed.kind === 'harmonic') return <HarmonicView key={parsed.personId} personId={parsed.personId} />;
  if (parsed.kind === 'periodic-transit') {
    return <PeriodicTransitView key={parsed.personId} personId={parsed.personId} />;
  }
  return <AstrocartographyView key={parsed.personId} personId={parsed.personId} />;
}
