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
 * English-only, deliberately: there is no locale switcher anywhere in this
 * app yet, so this component always assembles the report in `'en'` rather
 * than half-building a language picker that has nothing else to plug into. A
 * locale switcher is a separate concern from provenance traceability and can
 * be added later without changing this component's shape.
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
import type { CorpusEntry } from '../interpretation/schema.js';
import { describeParagraphProvenance } from './report-provenance.js';
import type { ChartData } from '../domain/chart-compute.js';

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
  const [corpus, setCorpus] = useState<readonly CorpusEntry[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    loadRuntimeCorpus('en')
      .then((loaded) => {
        if (!cancelled) setCorpus(loaded);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError !== undefined) {
    return (
      <div className="report">
        <p role="alert">Could not load the interpretation text: {loadError}</p>
      </div>
    );
  }
  if (corpus === undefined) {
    return (
      <div className="report">
        <p>Loading report…</p>
      </div>
    );
  }

  const report: Report = assembleReport(chart, 'en', corpus);

  return (
    <div className="report">
      <div className="report-controls">
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
