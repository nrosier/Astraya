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
import { ordered } from './people-list.js';
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
    return (
      <main className="shell">
        <p className="back">
          <a href="#/people">&larr; People</a>
        </p>
        <h1>Not found</h1>
        <p>
          There is no person with that id on this device. If they were deleted, they can be restored from the{' '}
          <a href="#/people">people list</a>.
        </p>
      </main>
    );
  }

  if (person.moment === undefined || person.timeAccuracy === 'unknown') {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || 'Person'}</a>
        </p>
        <h1>Composite</h1>
        <p>
          A composite chart needs midpoint houses from both people, so it needs a complete birth record with a known
          time. {person.displayName || 'This person'}&rsquo;s does not have one yet. Fill in or correct it on the{' '}
          <a href={`#/person/${personId}`}>person page</a>.
        </p>
      </main>
    );
  }

  const displayName =
    partner !== undefined ? `${person.displayName || 'Person A'} / ${partner.displayName || 'Person B'}` : '';

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || 'Person'}</a>
      </p>
      <h1>{person.displayName ? `${person.displayName}’s composite` : 'Composite'}</h1>
      <p className="hint">
        A synthetic midpoint chart between two natal charts &mdash; every position and house cusp is the near-arc
        midpoint of the two. Only people with a complete, known-time birth record can be combined.
      </p>

      <p>
        <label>
          Compose with{' '}
          <select
            value={partnerId}
            onChange={(event) => {
              setPartnerId(event.target.value);
            }}
          >
            <option value="">Choose a person&hellip;</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName || 'Unnamed'}
              </option>
            ))}
          </select>
        </label>
      </p>

      {partnerId !== '' && candidates.every((candidate) => candidate.id !== partnerId) && (
        <p className="warning" role="alert">
          That person is no longer available to compose with.
        </p>
      )}

      {partnerId !== '' && load.kind !== 'idle' && (
        <ChartDataView load={load} displayName={displayName || 'Composite'} showHouses metaLines={[displayName]} />
      )}
    </main>
  );
}
