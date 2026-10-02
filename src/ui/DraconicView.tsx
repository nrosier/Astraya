/**
 * The draconic chart for a saved person (#398).
 *
 * A draconic chart is a single synthetic chart derived from one natal chart, not a comparison
 * between two — like harmonic charts (#170), this screen reuses `ChartDataView` wholesale rather
 * than the multi-wheel renderer. Unlike harmonic, there is no in-screen parameter to pick: the
 * draconic zero-point is always the natal North Node, so this view has no picker at all.
 */
import { useEffect, useState } from 'react';
import { useEphemerisProvider } from './EphemerisProviderContext.js';
import { computeDraconic, type DraconicData } from '../domain/draconic.js';
import { housesAreDefined } from '../domain/chart-compute.js';
import { momentKey } from '../time/encode.js';
import { ChartDataView } from './ChartView.js';
import { ReportView } from './ReportView.js';
import { draconicViewMessages } from './DraconicView.messages.js';
import { useMessages } from './messages.js';
import { PersonNotFound } from './PersonNotFound.js';
import { useStoreState } from './store-context.js';
import type { ChartData } from '../domain/chart-compute.js';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: ChartData }
  | { readonly kind: 'error'; readonly message: string };

export function DraconicView({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);
  const t = useMessages(draconicViewMessages);

  const { provider } = useEphemerisProvider();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    if (person?.moment === undefined || provider === undefined) return undefined;
    const moment = person.moment;
    const effect = { cancelled: false };
    setLoad({ kind: 'loading' });

    void (async () => {
      try {
        const data: DraconicData = await computeDraconic(moment, provider);
        if (!effect.cancelled) setLoad({ kind: 'ready', data: data.draconic });
      } catch (error) {
        if (!effect.cancelled)
          setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      effect.cancelled = true;
    };
  }, [momentKey(person?.moment), provider]);

  if (person === undefined) {
    return <PersonNotFound />;
  }

  if (person.moment === undefined || person.timeAccuracy === 'unknown') {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
        </p>
        <h1>{t.draconicChartFallback}</h1>
        <p>
          {t.needsCompleteRecord(person.displayName || t.thisPerson)}{' '}
          <a href={`#/person/${personId}`}>{t.personPageLink}</a>.
        </p>
      </main>
    );
  }

  const displayName = person.displayName ? `${person.displayName} — ${t.headingFallback}` : t.headingFallback;

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
      </p>
      <h1>{person.displayName ? t.heading(person.displayName) : t.headingFallback}</h1>
      <p className="hint">{t.hint}</p>

      <ChartDataView load={load} displayName={displayName} showHouses metaLines={[t.headingFallback]} />

      {load.kind === 'ready' && !housesAreDefined(load.data.houses) && (
        <p className="warning" role="alert">
          {t.housesUndefined}
        </p>
      )}
      {load.kind === 'ready' && housesAreDefined(load.data.houses) && <ReportView chart={load.data} />}
    </main>
  );
}
