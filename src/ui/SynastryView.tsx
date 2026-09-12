/**
 * Synastry bi-wheel comparing a saved person against a second saved person (#172), using
 * #51's cross-chart aspect engine and #52's multi-ring renderer.
 *
 * The second person is picked from within this screen, not carried in the URL: every other
 * multi-word route in `route.ts` names exactly one person, and a synastry pairing changes far
 * more often within one visit (trying several comparisons) than it's worth making shareable
 * as a link. The picker only offers people with a complete, known-time birth moment — the
 * same requirement `person` itself is gated on below — since a bi-wheel needs houses on both
 * rings.
 *
 * The wheel bypasses `AstroChartWheel.tsx` (single-chart only) the same way `TransitView.tsx`
 * does, calling `renderMultiWheelSvg` directly. Unlike a transit wheel, neither side is a
 * "reference at rest" the other moves against, so `computeSynastry` uses each chart's own real
 * speed on both sides (see that module's doc comment) — and correspondingly there is no
 * inner/outer convention rooted in the astrology here, only in the SVG's ring order.
 */
import { useEffect, useMemo, useState } from 'react';
import { chartWheelRing, crossAspectRows, type AspectRow } from '../domain/chart-tables.js';
import { deriveExportFilename } from '../domain/export-filename.js';
import { computeSynastry, type SynastryData } from '../domain/synastry.js';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';
import { renderMultiWheelSvg, type CrossRingAspects } from '../chart/multi-wheel.js';
import { ordered } from './people-list.js';
import { SortableTable } from './SortableTable.js';
import { useStoreState } from './store-context.js';
import type { TableColumn } from './table-sort.js';
import type { EphemerisProvider } from '../ephemeris/types.js';

type Load =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: SynastryData }
  | { readonly kind: 'error'; readonly message: string };

const ASPECT_COLUMNS: readonly TableColumn<AspectRow>[] = [
  { key: 'bodyAName', label: 'Person A', valueOf: (row) => row.bodyAName },
  { key: 'aspect', label: 'Aspect', valueOf: (row) => row.aspect },
  { key: 'bodyBName', label: 'Person B', valueOf: (row) => row.bodyBName },
  { key: 'orb', label: 'Orb', valueOf: (row) => row.orb, render: (row) => `${row.orb.toFixed(2)}°` },
  {
    key: 'applying',
    label: 'Applying',
    valueOf: (row) => row.applying,
    render: (row) => (row.applying ? 'Applying' : 'Separating'),
  },
];

export function SynastryView({ personId }: { personId: string }): React.JSX.Element {
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
        const data = await computeSynastry(momentA, momentB, provider);
        if (!effect.cancelled) setLoad({ kind: 'ready', data });
      } catch (error) {
        if (!effect.cancelled)
          setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      effect.cancelled = true;
    };
  }, [person, partner, provider]);

  const wheelMarkup = useMemo(() => {
    if (load.kind !== 'ready') return undefined;
    const nameA: string = person?.displayName ?? '';
    const nameB: string = partner?.displayName ?? '';
    const ringA = chartWheelRing(load.data.chartA, nameA || 'Person A');
    const ringB = chartWheelRing(load.data.chartB, nameB || 'Person B');
    const crossAspects: readonly CrossRingAspects[] = [
      // `computeSynastry`'s aspects run bodyA from chartA (ring 0), bodyB from chartB (ring
      // 1) — outerRingIndex/innerRingIndex name which side of the aspect a ring resolves,
      // not radius order, so chartA is "outer" here even though it's drawn as ring 0.
      { outerRingIndex: 0, innerRingIndex: 1, aspects: load.data.aspects },
    ];
    return renderMultiWheelSvg([ringA, ringB], crossAspects);
  }, [load, person, partner]);

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
        <h1>Synastry</h1>
        <p>
          A synastry bi-wheel needs houses on both rings, so it needs a complete birth record with a known time.{' '}
          {person.displayName || 'This person'}&rsquo;s does not have one yet. Fill in or correct it on the{' '}
          <a href={`#/person/${personId}`}>person page</a>.
        </p>
      </main>
    );
  }

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || 'Person'}</a>
      </p>
      <h1>{person.displayName ? `${person.displayName}’s synastry` : 'Synastry'}</h1>
      <p className="hint">
        A bi-wheel comparing two natal charts, plus the aspects between them. Only people with a complete, known-time
        birth record can be compared.
      </p>

      <p>
        <label>
          Compare with{' '}
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
          That person is no longer available to compare with.
        </p>
      )}

      {load.kind === 'loading' && <p className="status">Calculating&hellip;</p>}

      {load.kind === 'error' && (
        <p className="warning" role="alert">
          Synastry could not be calculated. {load.message}
        </p>
      )}

      {load.kind === 'ready' && wheelMarkup !== undefined && (
        <>
          {/* App-generated SVG from just-computed chart data, never user-supplied markup —
              the same trust boundary ChartView.tsx's sheet markup is injected under. */}
          <div className="chart-wheel" dangerouslySetInnerHTML={{ __html: wheelMarkup }} />

          <SortableTable
            caption="Aspects"
            columns={ASPECT_COLUMNS}
            rows={crossAspectRows(load.data.aspects)}
            getRowKey={(row) => `${row.bodyAKey}-${row.aspect}-${row.bodyBKey}`}
            downloadFilename={deriveExportFilename(
              `${person.displayName || 'person'}-${(partner?.displayName ?? '') || 'partner'}`,
              'synastry-aspects',
              'csv',
            )}
          />
        </>
      )}
    </main>
  );
}
