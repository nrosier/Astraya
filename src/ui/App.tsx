import { useEffect, useState } from 'react';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';
import { About } from './About.js';
import { Changelog } from './Changelog.js';
import { APP_VERSION } from '../version.js';

/**
 * Application shell.
 *
 * Deliberately thin: M0's job is to prove the boundaries hold — worker, CSP,
 * version, AGPL obligations — not to build the chart UI. The birth-data form and
 * person selector arrive in M3, once the local-first store exists to hold them.
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

  if (route === '#/about') return <About seVersion={seVersion} />;
  if (route === '#/changelog') return <Changelog />;

  return (
    <main className="shell">
      <h1>Astraya</h1>
      <p className="tagline">Astrological charts, calculated properly.</p>

      <section aria-live="polite">
        {engineStatus === 'ready' ? (
          <p>
            Swiss Ephemeris <strong>{seVersion}</strong> loaded. Chart entry arrives in milestone M3.
          </p>
        ) : (
          <p className="status">{engineStatus}</p>
        )}
      </section>

      <footer>
        {/* The version itself is the changelog link: clicking a version to see
            what changed in it is the behaviour people expect. */}
        <a href="#/changelog">Version {APP_VERSION}</a> &middot; <a href="#/about">about &amp; licence</a>
      </footer>
    </main>
  );
}
