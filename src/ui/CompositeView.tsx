/**
 * Composite (midpoint) chart between a saved person and a second saved person (#169), using
 * #30's near-arc midpoint convention for positions and the same convention applied to house
 * cusps (see `composite.ts`'s own doc comment for why: there is no single Julian day to hand
 * an ephemeris for a "recompute houses from a midpoint Ascendant/MC" approach, and the
 * time/space-midpoint "Davison" method is this issue's own explicit non-goal).
 *
 * The second person is picked from within this screen, not carried in the URL — the same
 * reasoning `SynastryView.tsx` gives for its own partner picker applies unchanged here. Unlike
 * synastry, the composite is a single synthetic `ChartData`, not a comparison between two live
 * ones, so this screen reuses `ChartDataView` wholesale (the same way `SharedChartView.tsx`
 * does) rather than calling the multi-wheel renderer directly.
 */
import { useEffect, useMemo, useState } from 'react';
import { computeComposite, type CompositeData } from '../domain/composite.js';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';
import { ChartDataView } from './ChartView.js';
import { compositeViewMessages } from './CompositeView.messages.js';
import { useMessages } from './messages.js';
import { ordered } from './people-list.js';
import { PersonNotFound } from './PersonNotFound.js';
import { useStoreState } from './store-context.js';
import type { ChartData } from '../domain/chart-compute.js';
import type { EphemerisProvider } from '../ephemeris/types.js';

type Load =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: ChartData }
  | { readonly kind: 'error'; readonly message: string };

export function CompositeView({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);
  const t = useMessages(compositeViewMessages);

  const candidates = useMemo(
    () =>
      ordered(state.people).filter(
        (candidate) =>
          candidate.id !== personId && candidate.moment !== undefined && candidate.timeAccuracy !== 'unknown',
      ),
    [state.people, personId],
  );
  const [partnerId, setPartnerId] = useState<string>('');
  const partner = partnerId === '' ? undefined : state.people.get(partnerId);

  const [provider, setProvider] = useState<EphemerisProvider | undefined>(undefined);
  const [load, setLoad] = useState<Load>({ kind: 'idle' });

  useEffect(() => {
    const worker = new WorkerEphemerisProvider();
    const effect = { cancelled: false };
    void worker.initialize().then(() => {
      if (!effect.cancelled) setProvider(worker);
    });
    return () => {
      effect.cancelled = true;
      void worker.dispose();
    };
  }, []);

  useEffect(() => {
    if (person?.moment === undefined || partner?.moment === undefined || provider === undefined) {
      setLoad({ kind: 'idle' });
      return undefined;
    }
    const momentA = person.moment;
    const momentB = partner.moment;
    const effect = { cancelled: false };
    setLoad({ kind: 'loading' });

    void (async () => {
      try {
        const data: CompositeData = await computeComposite(momentA, momentB, provider);
        if (!effect.cancelled) setLoad({ kind: 'ready', data: data.composite });
      } catch (error) {
        if (!effect.cancelled)
          setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      effect.cancelled = true;
    };
  }, [person, partner, provider]);

  if (person === undefined) {
    return <PersonNotFound />;
  }

  if (person.moment === undefined || person.timeAccuracy === 'unknown') {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
        </p>
        <h1>{t.compositeFallback}</h1>
        <p>
          {t.needsCompleteRecord(person.displayName || t.thisPerson)}{' '}
          <a href={`#/person/${personId}`}>{t.personPageLink}</a>.
        </p>
      </main>
    );
  }

  const displayName =
    partner !== undefined ? `${person.displayName || t.personALabel} / ${partner.displayName || t.personBLabel}` : '';

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
      </p>
      <h1>{person.displayName ? t.heading(person.displayName) : t.compositeFallback}</h1>
      <p className="hint">{t.hint}</p>

      <p>
        <label>
          {t.composeWithLabel}{' '}
          <select
            value={partnerId}
            onChange={(event) => {
              setPartnerId(event.target.value);
            }}
          >
            <option value="">{t.choosePersonOption}</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName || t.unnamedOption}
              </option>
            ))}
          </select>
        </label>
      </p>

      {partnerId !== '' && candidates.every((candidate) => candidate.id !== partnerId) && (
        <p className="warning" role="alert">
          {t.partnerGoneWarning}
        </p>
      )}

      {partnerId !== '' && load.kind !== 'idle' && (
        <ChartDataView
          load={load}
          displayName={displayName || t.compositeFallback}
          showHouses
          metaLines={[displayName]}
        />
      )}
    </main>
  );
}
