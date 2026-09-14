import { APP_BUILT_AT, APP_COMMIT, APP_VERSION, SOURCE_URL, SOURCE_URL_FOR_BUILD } from '../version.js';
import { aboutMessages } from './About.messages.js';
import { useMessages } from './messages.js';
import { sharedMessages } from './shared.messages.js';

/**
 * About page.
 *
 * This page is an obligation, not a nicety. The AGPL's network clause requires
 * that users of a hosted Astraya be offered the corresponding source, and
 * Astrodienst requires visible credit for the Swiss Ephemeris. It also carries the
 * privacy statement, which must say what is stored, where, who can read it and how
 * to delete it.
 */
export function About({ seVersion }: { seVersion?: string | undefined }): React.JSX.Element {
  const t = useMessages(aboutMessages);
  const shared = useMessages(sharedMessages);
  return (
    <main className="shell">
      <p className="back">
        <a href="#/">&larr; {shared.back}</a>
      </p>
      <h1>{t.heading}</h1>

      <h2>{t.versionHeading}</h2>
      <dl>
        <dt>{t.releaseLabel}</dt>
        <dd>{APP_VERSION}</dd>
        <dt>{t.commitLabel}</dt>
        <dd>{APP_COMMIT}</dd>
        <dt>{t.builtLabel}</dt>
        <dd>{APP_BUILT_AT}</dd>
        <dt>{t.swissEphemerisLabel}</dt>
        <dd>{seVersion ?? t.notLoaded}</dd>
      </dl>
      <p>
        <a href="#/changelog">{t.changelogLink}</a>
      </p>

      <h2>{t.yourDataHeading}</h2>
      <p>
        {t.yourDataParagraph1Before}
        <strong>{t.yourDataParagraph1Strong}</strong>
        {t.yourDataParagraph1After}
      </p>
      <p>
        {t.yourDataParagraph2Before}
        <strong>{t.yourDataParagraph2Strong}</strong>
        {t.yourDataParagraph2After}
      </p>
      <p>
        {t.yourDataParagraph3Before}
        <em>{t.yourDataParagraph3Em}</em>
        {t.yourDataParagraph3After}
      </p>
      <p>{t.yourDataParagraph4}</p>
      <p>{t.yourDataParagraph5}</p>

      <h2>{t.licenceHeading}</h2>
      <p>
        {t.licenceParagraphBefore}
        <strong>{t.licenceParagraphStrong}</strong>
        {t.licenceParagraphAfter}
      </p>
      <p>
        <a href={SOURCE_URL_FOR_BUILD}>{t.sourceCodeLink}</a>
      </p>

      <h2>{t.acknowledgementsHeading}</h2>
      <p>
        {t.acknowledgementsParagraph1Before}
        <strong>{t.acknowledgementsParagraph1Strong}</strong>
        {t.acknowledgementsParagraph1After}
      </p>
      <p>
        {t.acknowledgementsParagraph2Before}
        <a href={`${SOURCE_URL}/blob/main/NOTICE`}>NOTICE</a>
        {t.acknowledgementsParagraph2After}
      </p>
    </main>
  );
}
