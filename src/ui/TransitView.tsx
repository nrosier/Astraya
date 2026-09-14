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
import { todayInputValue } from './format.js';
import { useMessages } from './messages.js';
import { PersonNotFound } from './PersonNotFound.js';
import { SortableTable } from './SortableTable.js';
import { useStoreState } from './store-context.js';
import { transitViewMessages } from './TransitView.messages.js';
import type { TableColumn } from './table-sort.js';
import type { EphemerisProvider } from '../ephemeris/types.js';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: TransitData }
  | { readonly kind: 'error'; readonly message: string };

function contactColumns(t: typeof transitViewMessages.en): readonly TableColumn<AspectRow>[] {
  return [
    { key: 'bodyAName', label: t.transitingLabel, valueOf: (row) => row.bodyAName },
    { key: 'aspect', label: t.aspectLabel, valueOf: (row) => row.aspect },
    { key: 'bodyBName', label: t.natalLabel, valueOf: (row) => row.bodyBName },
    { key: 'orb', label: t.orbLabel, valueOf: (row) => row.orb, render: (row) => `${row.orb.toFixed(2)}°` },
    {
      key: 'applying',
      label: t.applyingLabel,
      valueOf: (row) => row.applying,
      render: (row) => (row.applying ? t.applying : t.separating),
    },
  ];
}

export function TransitView({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);
  const t = useMessages(transitViewMessages);
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
    return <PersonNotFound />;
  }

  if (person.moment === undefined) {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
        </p>
        <h1>{t.transitsFallback}</h1>
        <p>
          {t.notCompleteTransits(person.displayName || t.thisPerson)}{' '}
          <a href={`#/person/${personId}`}>{t.personPageLink}</a>.
        </p>
      </main>
    );
  }

  if (person.timeAccuracy === 'unknown') {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
        </p>
        <h1>{t.transitsFallback}</h1>
        <p>{t.needsKnownTime(person.displayName || t.thisPerson)}</p>
      </main>
    );
  }

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
      </p>
      <h1>{person.displayName ? t.heading(person.displayName) : t.transitsFallback}</h1>
      <p className="hint">{t.hint(person.displayName || t.thisPerson)}</p>

      <p>
        <label>
          {t.asOfLabel}{' '}
          <input
            type="date"
            value={asOf}
            onChange={(event) => {
              setAsOf(event.target.value);
            }}
          />
        </label>
      </p>

      {load.kind === 'loading' && <p className="status">{t.calculating}</p>}

      {load.kind === 'error' && (
        <p className="warning" role="alert">
          {t.error(load.message)}
        </p>
      )}

      {load.kind === 'ready' && wheelMarkup !== undefined && (
        <>
          {/* App-generated SVG from just-computed chart data, never user-supplied markup —
              the same trust boundary ChartView.tsx's sheet markup is injected under. */}
          <div className="chart-wheel" dangerouslySetInnerHTML={{ __html: wheelMarkup }} />

          <SortableTable
            caption={t.contactsCaption}
            columns={contactColumns(t)}
            rows={crossAspectRows(load.data.contacts)}
            getRowKey={(row) => `${row.bodyAKey}-${row.aspect}-${row.bodyBKey}`}
            downloadFilename={deriveExportFilename(person.displayName, 'transit-contacts', 'csv')}
          />
        </>
      )}
    </main>
  );
}
