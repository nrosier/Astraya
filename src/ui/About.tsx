import { APP_BUILT_AT, APP_COMMIT, APP_VERSION, SOURCE_URL, SOURCE_URL_FOR_BUILD } from '../version.js';

/**
 * About page.
 *
 * This page is an obligation, not a nicety. The AGPL's network clause requires
 * that users of a hosted Astraea be offered the corresponding source, and
 * Astrodienst requires visible credit for the Swiss Ephemeris. It also carries the
 * privacy statement, which must say what is stored, where, who can read it and how
 * to delete it.
 */
export function About({ seVersion }: { seVersion?: string | undefined }): React.JSX.Element {
  return (
    <main className="shell">
      <p>
        <a href="#/">&larr; Back</a>
      </p>
      <h1>About Astraea</h1>

      <h2>Version</h2>
      <dl>
        <dt>Release</dt>
        <dd>{APP_VERSION}</dd>
        <dt>Commit</dt>
        <dd>{APP_COMMIT}</dd>
        <dt>Built</dt>
        <dd>{APP_BUILT_AT}</dd>
        <dt>Swiss Ephemeris</dt>
        <dd>{seVersion ?? 'not loaded'}</dd>
      </dl>
      <p>
        <a href={`${SOURCE_URL}/blob/main/CHANGELOG.md`}>Changelog</a>
      </p>

      <h2>Your data</h2>
      <p>
        Charts are calculated <strong>entirely in your browser</strong>. Birth data you enter is stored on this device,
        in its IndexedDB storage, and that copy is the authoritative one.
      </p>
      <p>
        If you are not signed in, <strong>nothing you enter ever leaves this device</strong>. There is no analytics, no
        tracking and no third-party request; the app makes no network call at all once it has loaded.
      </p>
      <p>
        If you sign in, your people and charts sync to <em>this server</em> so they reach your other devices. They are
        not shared with anyone else and are never sent to a third party. They are encrypted at rest. Note honestly that
        this protects a stolen database file or backup, not someone who has compromised the server itself, because the
        server needs the key in order to run.
      </p>
      <p>
        You can delete any person, along with every chart derived from them, from the person list. Deleting clears the
        local copy and instructs the server to drop its copy.
      </p>
      <p>
        Interpretation text is written ahead of release and shipped as part of the application. No AI service is
        contacted while you use Astraea — the Content Security Policy makes that impossible rather than merely
        unintended.
      </p>

      <h2>Licence and source</h2>
      <p>
        Astraea is free software under the <strong>GNU Affero General Public License, version 3 or later</strong>. You
        may use, study, modify and redistribute it under those terms. Because the AGPL covers use over a network, you
        are entitled to the source code of this running instance:
      </p>
      <p>
        <a href={SOURCE_URL_FOR_BUILD}>Source code for this build</a>
      </p>

      <h2>Acknowledgements</h2>
      <p>
        Positions are computed with the <strong>Swiss Ephemeris</strong>, copyright &copy; 1997&ndash;2021 Astrodienst
        AG, Zürich, used under the AGPL. Swiss Ephemeris derives from the NASA JPL DE431 planetary ephemeris.
        Astrodienst asks that this credit be visible, and it is.
      </p>
      <p>
        Reference positions used to test Astraea come from the NASA JPL Horizons system. A full list of third-party
        components and their licences is in <a href={`${SOURCE_URL}/blob/main/NOTICE`}>NOTICE</a>.
      </p>
    </main>
  );
}
