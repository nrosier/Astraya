/**
 * The written interpretation for whatever is selected on the chart wheel (#415): the same corpus
 * text the Interpretation tab shows for those placements, under the facts the selection panel
 * already gives. It resolves each entry through `resolvePlacementText`, so a placement the corpus
 * has no entry for still gets the mechanical sentence rather than nothing, and uses the device's
 * saved advisor voice, so the two screens read alike.
 *
 * The corpus is fetched on the first selection (it is not loaded with the wheel) and kept per
 * language and voice, so later clicks show their text at once.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ChartData } from '../domain/chart-compute.js';
import { resolvePlacementText } from '../interpretation/compose.js';
import type { CorpusEntry, Locale } from '../interpretation/schema.js';
import { parseSelectionKey, selectionPlacements } from '../interpretation/selection.js';
import { chartViewMessages } from './ChartView.messages.js';
import { useMessages } from './messages.js';
import { initialPersona } from './report-persona.js';
import { wheelCorpus } from './wheel-corpus.js';
import { placementHeading, SELECTION_TEXT_LIMIT } from './wheel-selection.js';

export function WheelSelectionText({
  chart,
  selectionKey,
  locale,
}: {
  readonly chart: ChartData;
  readonly selectionKey: string;
  readonly locale: Locale;
}): React.JSX.Element | null {
  const t = useMessages(chartViewMessages);
  const persona = useMemo(initialPersona, []);
  const [corpus, setCorpus] = useState<readonly CorpusEntry[] | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCorpus(undefined);
    setFailed(false);
    wheelCorpus(locale, persona).then(
      (loaded) => {
        if (!cancelled) setCorpus(loaded);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [locale, persona]);

  // A new selection starts collapsed again.
  useEffect(() => {
    setShowAll(false);
  }, [selectionKey]);

  const items = useMemo(() => {
    const selection = parseSelectionKey(selectionKey);
    return selection === undefined ? [] : selectionPlacements(chart, selection);
  }, [chart, selectionKey]);

  if (items.length === 0) return null;

  const labels = {
    house: t.houseLabel,
    dignityStates: t.dignityStateLabels,
    cuspOf: t.cuspHeading,
  };
  const shown = showAll ? items : items.slice(0, SELECTION_TEXT_LIMIT);

  return (
    <section className="chart-isolation-interpretation" aria-label={t.selectionInterpretationHeading}>
      <h4>{t.selectionInterpretationHeading}</h4>
      {failed && <p className="hint">{t.selectionUnavailable}</p>}
      {!failed && corpus === undefined && <p className="hint">{t.selectionLoading}</p>}
      {corpus !== undefined && (
        <>
          <ul className="chart-isolation-texts">
            {shown.map((item) => (
              <li key={item.key}>
                <strong>{placementHeading(item.placement, locale, labels)}</strong>
                <p>{resolvePlacementText(item.placement, locale, corpus, persona)}</p>
              </li>
            ))}
          </ul>
          {items.length > SELECTION_TEXT_LIMIT && (
            <button
              type="button"
              className="quiet"
              onClick={() => {
                setShowAll((current) => !current);
              }}
            >
              {showAll ? t.selectionShowFewer : t.selectionShowAll(items.length)}
            </button>
          )}
        </>
      )}
    </section>
  );
}
