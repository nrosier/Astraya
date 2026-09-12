/**
 * Transit bi-wheel for one saved person against a chosen moment (#172), using #51's
 * cross-chart aspect engine and #52's multi-ring renderer.
 *
 * Structured the same way as `ProfectionsView.tsx`: same "as of" date input (defaulting to
 * today), same worker-ephemeris lifecycle, same person-not-found / incomplete-moment /
 * unknown-time-accuracy gating — a transit's houses are cast for both rings, so an unknown
 * birth time makes the whole screen as meaningless as it makes `ChartView.tsx`'s houses tab
 * or `ProfectionsView.tsx` itself.
 *
 * The wheel bypasses `AstroChartWheel.tsx` (the third-party `@astrodraw/astrochart` wrapper,
 * single-chart only) entirely and calls `renderMultiWheelSvg` directly with two rings built
 * by `chartWheelRing` — natal innermost, transiting outer, matching how most astrology
 * software draws a transit wheel and matching `computeTransit`'s own contacts ordering
 * (moving/transiting first). The result is a complete standalone `<svg>` (default, non-`bare`
 * options), injected the same trust-boundary way `ChartView.tsx` injects its sheet markup:
 * entirely app-generated from just-computed data, never user-supplied.
 */
import { useEffect, useMemo, useState } from 'react';
import { chartWheelRing, crossAspectRows, type AspectRow } from '../domain/chart-tables.js';
import { deriveExportFilename } from '../domain/export-filename.js';
import { computeTransit, type TransitData } from '../domain/transit.js';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';
import { renderMultiWheelSvg, type CrossRingAspects } from '../chart/multi-wheel.js';
import { SortableTable } from './SortableTable.js';
import { useStoreState } from './store-context.js';
import type { TableColumn } from './table-sort.js';
import type { EphemerisProvider } from '../ephemeris/types.js';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: TransitData }
  | { readonly kind: 'error'; readonly message: string };

const CONTACT_COLUMNS: readonly TableColumn<AspectRow>[] = [
  { key: 'bodyAName', label: 'Transiting', valueOf: (row) => row.bodyAName },
  { key: 'aspect', label: 'Aspect', valueOf: (row) => row.aspect },
  { key: 'bodyBName', label: 'Natal', valueOf: (row) => row.bodyBName },
  { key: 'orb', label: 'Orb', valueOf: (row) => row.orb, render: (row) => `${row.orb.toFixed(2)}°` },
  {
    key: 'applying',
    label: 'Applying',
    valueOf: (row) => row.applying,
    render: (row) => (row.applying ? 'Applying' : 'Separating'),
  },
];

/** Today's date as a `<input type="date">` value, in the visitor's local calendar. */
function todayInputValue(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function TransitView({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);
  const [asOf, setAsOf] = useState(todayInputValue);
  const [provider, setProvider] = useState<EphemerisProvider | undefined>(undefined);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

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

  const targetDate = useMemo(() => {
    const [year, month, day] = asOf.split('-').map(Number);
    return year !== undefined && month !== undefined && day !== undefined ? { year, month, day } : undefined;
  }, [asOf]);

  useEffect(() => {
    if (person?.moment === undefined || provider === undefined || targetDate === undefined) return undefined;
    const moment = person.moment;
    const effect = { cancelled: false };
    setLoad({ kind: 'loading' });

    void (async () => {
      try {
        // Noon, not midnight — same reasoning as ProfectionsView.tsx: a date picker names a
        // day, not a moment, and noon keeps the civil day intact under any offset the target's
        // own calculation might apply.
        const targetJd = await provider.julianDayFromUtc(targetDate.year, targetDate.month, targetDate.day, 12, 0, 0);
        const data = await computeTransit(moment, targetJd, provider);
        if (!effect.cancelled) setLoad({ kind: 'ready', data });
      } catch (error) {
        if (!effect.cancelled)
          setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      effect.cancelled = true;
    };
  }, [person, provider, targetDate]);

  const wheelMarkup = useMemo(() => {
    if (load.kind !== 'ready') return undefined;
    const natalRing = chartWheelRing(load.data.natal, 'Natal');
    const transitRing = chartWheelRing(load.data.transit, 'Transit');
    const crossAspects: readonly CrossRingAspects[] = [
      // Natal is ring 0 (innermost), transit ring 1 (outer). `computeTransit`'s contacts are
      // already ordered transiting-first (bodyA), natal-second (bodyB) — the same order
      // `outerRingIndex`/`innerRingIndex` expect.
      { innerRingIndex: 0, outerRingIndex: 1, aspects: load.data.contacts },
    ];
    return renderMultiWheelSvg([natalRing, transitRing], crossAspects);
  }, [load]);

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

  if (person.moment === undefined) {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || 'Person'}</a>
        </p>
        <h1>Transits</h1>
        <p>
          {person.displayName || 'This person'}&rsquo;s birth record is not complete enough to calculate transits yet.
          Fill in the missing fields on the <a href={`#/person/${personId}`}>person page</a>.
        </p>
      </main>
    );
  }

  if (person.timeAccuracy === 'unknown') {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || 'Person'}</a>
        </p>
        <h1>Transits</h1>
        <p>
          A transit wheel needs houses on both rings, so it needs a known birth time.{' '}
          {person.displayName || 'This person'}&rsquo;s birth time is unknown &mdash; the same reason their chart has no
          houses.
        </p>
      </main>
    );
  }

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || 'Person'}</a>
      </p>
      <h1>{person.displayName ? `${person.displayName}’s transits` : 'Transits'}</h1>
      <p className="hint">
        A bi-wheel: {person.displayName || 'this person'}&rsquo;s natal chart on the inner ring, transiting positions
        for the chosen date on the outer ring, cast for their natal place.
      </p>

      <p>
        <label>
          As of{' '}
          <input
            type="date"
            value={asOf}
            onChange={(event) => {
              setAsOf(event.target.value);
            }}
          />
        </label>
      </p>

      {load.kind === 'loading' && <p className="status">Calculating&hellip;</p>}

      {load.kind === 'error' && (
        <p className="warning" role="alert">
          Transits could not be calculated. {load.message}
        </p>
      )}

      {load.kind === 'ready' && wheelMarkup !== undefined && (
        <>
          {/* App-generated SVG from just-computed chart data, never user-supplied markup —
              the same trust boundary ChartView.tsx's sheet markup is injected under. */}
          <div className="chart-wheel" dangerouslySetInnerHTML={{ __html: wheelMarkup }} />

          <SortableTable
            caption="Contacts"
            columns={CONTACT_COLUMNS}
            rows={crossAspectRows(load.data.contacts)}
            getRowKey={(row) => `${row.bodyAKey}-${row.aspect}-${row.bodyBKey}`}
            downloadFilename={deriveExportFilename(person.displayName, 'transit-contacts', 'csv')}
          />
        </>
      )}
    </main>
  );
}
