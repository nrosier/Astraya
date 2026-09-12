/**
 * Renders one `Report` (#61) as a list of named sections, each a list of
 * paragraphs — the "Report" tab `ChartView.tsx` wires in. A "Show provenance"
 * toggle exposes, per paragraph, where its text came from (a corpus entry,
 * the mechanical fallback, or a chart-derived sentence) and, when the rule
 * engine ranked it, the factors behind that ranking — #62's "why this text?"
 * requirement.
 *
 * Thin wiring only: every string shown here is pre-formatted by
 * `report-provenance.ts`, which is plain and Vitest-testable, following the
 * same "thin `.tsx`, tested `.ts`" split `SortableTable.tsx`/`table-sort.ts`
 * already use.
 *
 * Advisor is user-selectable here: `assembleReport` and `loadRuntimeCorpus`
 * already take a `Locale`/`PersonaId` (the corpus is fully generated for
 * both `en` and `nl`, all five personas), this component exposes the
 * persona choice and remembers it per device, the same
 * `localStorage`-persisted-preference pattern `session-context.tsx` uses for
 * the last signed-in user. Persona is optional — "neutral" (no persona
 * selected) falls back to the same voice every report used before this
 * picker existed. Language is a shared, app-wide setting (`locale.ts`), not
 * this component's own state — this view only consumes it.
 *
 * Fetches its corpus chunk at runtime via `loadRuntimeCorpus` rather than
 * importing `CORPUS` from `../interpretation/index.js` — that export is the
 * full, synchronous, every-locale-every-persona corpus the test suite needs,
 * and importing it here would inline all of it into this app's JS bundle.
 * See corpus-client.ts for why.
 */
import { useEffect, useState } from 'react';
import { assembleReport, type Report, type ReportParagraph } from '../interpretation/report.js';
import { loadRuntimeCorpus } from '../interpretation/corpus-client.js';
import { PERSONA_IDS, type CorpusEntry, type Locale, type PersonaId } from '../interpretation/schema.js';
import { describeParagraphProvenance } from './report-provenance.js';
import { useLocale } from './locale.js';
import type { ChartData } from '../domain/chart-compute.js';

const PERSONA_KEY = 'astraya:reportPersona';

/**
 * Mirrors `tools/corpus-gen/personas.json`'s `title` field — kept as a plain
 * literal here, the same reasoning `schema.ts`'s own `PERSONA_IDS` comment
 * gives for not reading that file at runtime: this stays a pure client
 * module with no filesystem access. `test/ui-report-view.test.tsx` asserts
 * these titles stay in sync with that file, the same way
 * `test/interpretation-schema.test.ts` already does for the id list itself.
 */
export const PERSONA_LABELS: Readonly<Record<PersonaId, Readonly<Record<Locale, string>>>> = {
  traditionalist: { en: 'The Strict Traditionalist', nl: 'De Strenge Traditionalist' },
  big_sister: { en: 'The Cozy Cosmic Big Sister', nl: 'De Warme Kosmische Zus' },
  cynic: { en: 'The Irreverent Cynic', nl: 'De Cynische Realist' },
  mystic: { en: 'The Evolutionary Mystic', nl: 'De Esoterische Mysticus' },
  pragmatist: { en: 'The Pragmatic No-Nonsense Coach', nl: 'De Praktische No-Nonsense Coach' },
};

function isPersonaId(value: string): value is PersonaId {
  return (PERSONA_IDS as readonly string[]).includes(value);
}

function initialPersona(): PersonaId | undefined {
  const stored = localStorage.getItem(PERSONA_KEY);
  return stored !== null && isPersonaId(stored) ? stored : undefined;
}

function Paragraph({
  paragraph,
  showProvenance,
}: {
  readonly paragraph: ReportParagraph;
  readonly showProvenance: boolean;
}): React.JSX.Element {
  const provenance = describeParagraphProvenance(paragraph);
  return (
    <li className="report-paragraph">
      <p>{paragraph.text}</p>
      {showProvenance && (
        <p className="report-provenance hint">
          {provenance.placement !== undefined && <>{provenance.placement} &middot; </>}
          {provenance.source}
          {provenance.factors !== undefined && <> &mdash; {provenance.factors}</>}
        </p>
      )}
    </li>
  );
}

export function ReportView({ chart }: { readonly chart: ChartData }): React.JSX.Element {
  const [showProvenance, setShowProvenance] = useState(false);
  const [locale] = useLocale();
  const [persona, setPersona] = useState<PersonaId | undefined>(initialPersona);
  const [corpus, setCorpus] = useState<readonly CorpusEntry[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setCorpus(undefined);
    setLoadError(undefined);
    loadRuntimeCorpus(locale, persona)
      .then((loaded) => {
        if (!cancelled) setCorpus(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [locale, persona]);

  const controls = (
    <div className="report-controls">
      <label>
        Advisor
        <select
          value={persona ?? ''}
          onChange={(event) => {
            const next = event.target.value;
            if (next === '') {
              localStorage.removeItem(PERSONA_KEY);
              setPersona(undefined);
              return;
            }
            if (!isPersonaId(next)) return;
            localStorage.setItem(PERSONA_KEY, next);
            setPersona(next);
          }}
        >
          <option value="">Neutral</option>
          {PERSONA_IDS.map((option) => (
            <option key={option} value={option}>
              {PERSONA_LABELS[option][locale]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={showProvenance}
          onChange={(event) => {
            setShowProvenance(event.target.checked);
          }}
        />{' '}
        Show provenance (rule and corpus entry) for each paragraph
      </label>
    </div>
  );

  if (loadError !== undefined) {
    return (
      <div className="report">
        {controls}
        <p role="alert">Could not load the interpretation text: {loadError}</p>
      </div>
    );
  }
  if (corpus === undefined) {
    return (
      <div className="report">
        {controls}
        <p>Loading report…</p>
      </div>
    );
  }

  const report: Report = assembleReport(chart, locale, corpus, persona);

  return (
    <div className="report">
      {controls}
      {report.sections.map((section) => (
        <section key={section.id} className="report-section">
          <h3>{section.title}</h3>
          <ul>
            {section.paragraphs.map((paragraph, index) => (
              <Paragraph key={`${section.id}-${String(index)}`} paragraph={paragraph} showProvenance={showProvenance} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
