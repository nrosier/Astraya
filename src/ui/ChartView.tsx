/**
 * Data tables for every quantity a chart computes (#44).
 *
 * Every number here is recalculated on the fly from the person's stored birth
 * moment — nothing is read from a saved `Chart`, because `Chart` holds no
 * computed positions by design (see `chart.ts`'s own doc comment) and no
 * screen yet exists to create one. `chart-compute.ts` does the one pass over
 * the ephemeris; `chart-tables.ts` shapes the result into the rows below.
 *
 * Houses, angles and the two derived points (both built on the Ascendant) are
 * hidden when `person.timeAccuracy === 'unknown'` — not merely approximated —
 * matching the warning `PersonForm.tsx` already gives about the same person:
 * an unknown birth time makes them meaningless rather than imprecise.
 */
import { useEffect, useState } from 'react';
import {
  angleRows,
  aspectRows,
  derivedPointRows,
  dignityRows,
  houseCuspRows,
  positionRows,
  type AngleRow,
  type AspectRow,
  type DerivedPointRow,
  type DignityRow,
  type HouseCuspRow,
  type PositionRow,
} from '../domain/chart-tables.js';
import { computeChartData, type ChartData } from '../domain/chart-compute.js';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';
import { SortableTable } from './SortableTable.js';
import { useStoreState } from './store-context.js';
import type { TableColumn } from './table-sort.js';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: ChartData }
  | { readonly kind: 'error'; readonly message: string };

const degreeColumns = <
  T extends { readonly sign: string; readonly degree: number; readonly minute: number; readonly second: number },
>(): readonly TableColumn<T>[] => [
  { key: 'sign', label: 'Sign', valueOf: (row) => row.sign },
  { key: 'degree', label: 'Deg', valueOf: (row) => row.degree },
  { key: 'minute', label: 'Min', valueOf: (row) => row.minute },
  { key: 'second', label: 'Sec', valueOf: (row) => row.second },
];

const POSITION_COLUMNS: readonly TableColumn<PositionRow>[] = [
  { key: 'bodyName', label: 'Body', valueOf: (row) => row.bodyName },
  ...degreeColumns<PositionRow>(),
  { key: 'house', label: 'House', valueOf: (row) => row.house },
  { key: 'speed', label: 'Speed', valueOf: (row) => row.speed, render: (row) => row.speed.toFixed(4) },
  { key: 'retrograde', label: 'Rx', valueOf: (row) => row.retrograde, render: (row) => (row.retrograde ? '℞' : '') },
];

const HOUSE_CUSP_COLUMNS: readonly TableColumn<HouseCuspRow>[] = [
  { key: 'house', label: 'House', valueOf: (row) => row.house },
  ...degreeColumns<HouseCuspRow>(),
];

const ANGLE_COLUMNS: readonly TableColumn<AngleRow>[] = [
  { key: 'label', label: 'Angle', valueOf: (row) => row.label },
  ...degreeColumns<AngleRow>(),
];

const ASPECT_COLUMNS: readonly TableColumn<AspectRow>[] = [
  { key: 'bodyAName', label: 'Body A', valueOf: (row) => row.bodyAName },
  { key: 'aspect', label: 'Aspect', valueOf: (row) => row.aspect },
  { key: 'bodyBName', label: 'Body B', valueOf: (row) => row.bodyBName },
  { key: 'orb', label: 'Orb', valueOf: (row) => row.orb, render: (row) => `${row.orb.toFixed(2)}°` },
  {
    key: 'applying',
    label: 'Applying',
    valueOf: (row) => row.applying,
    render: (row) => (row.applying ? 'Applying' : 'Separating'),
  },
];

const DIGNITY_COLUMNS: readonly TableColumn<DignityRow>[] = [
  { key: 'bodyName', label: 'Body', valueOf: (row) => row.bodyName },
  { key: 'ruler', label: 'Ruler', valueOf: (row) => row.ruler, render: (row) => (row.ruler ? '✓' : '') },
  { key: 'exalted', label: 'Exalted', valueOf: (row) => row.exalted, render: (row) => (row.exalted ? '✓' : '') },
  {
    key: 'detriment',
    label: 'Detriment',
    valueOf: (row) => row.detriment,
    render: (row) => (row.detriment ? '✓' : ''),
  },
  { key: 'fall', label: 'Fall', valueOf: (row) => row.fall, render: (row) => (row.fall ? '✓' : '') },
];

const DERIVED_POINT_COLUMNS: readonly TableColumn<DerivedPointRow>[] = [
  { key: 'label', label: 'Point', valueOf: (row) => row.label },
  ...degreeColumns<DerivedPointRow>(),
];

export function ChartView({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    if (person?.moment === undefined) return undefined;
    const moment = person.moment;
    const provider = new WorkerEphemerisProvider();
    // A mutable holder rather than a `let`, matching `App.tsx`'s own effect below.
    const effect = { cancelled: false };
    setLoad({ kind: 'loading' });

    void (async () => {
      try {
        await provider.initialize();
        const data = await computeChartData(moment, provider);
        if (!effect.cancelled) setLoad({ kind: 'ready', data });
      } catch (error) {
        if (!effect.cancelled)
          setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      effect.cancelled = true;
      void provider.dispose();
    };
  }, [personId, person]);

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
        <h1>Chart</h1>
        <p>
          {person.displayName || 'This person'}&rsquo;s birth record is not complete enough to calculate a chart yet.
          Fill in the missing fields on the <a href={`#/person/${personId}`}>person page</a>.
        </p>
      </main>
    );
  }

  const showHouses = person.timeAccuracy !== 'unknown';

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || 'Person'}</a>
      </p>
      <h1>{person.displayName || 'Chart'}</h1>

      {!showHouses && (
        <p className="hint">
          The birth time for {person.displayName || 'this person'} is unknown, so houses, angles and the Ascendant-based
          derived points cannot be calculated &mdash; they are not shown below. Positions, aspects and dignities are
          still meaningful, though the Moon&rsquo;s sign may be uncertain.
        </p>
      )}

      {load.kind === 'loading' && <p className="status">Calculating&hellip;</p>}

      {load.kind === 'error' && (
        <p className="warning" role="alert">
          The chart could not be calculated. {load.message}
        </p>
      )}

      {load.kind === 'ready' && (
        <>
          {load.data.houses.warning !== undefined && (
            <p className="warning" role="alert">
              {load.data.houses.warning}
            </p>
          )}

          <h2>Positions</h2>
          <SortableTable
            caption="Positions"
            columns={POSITION_COLUMNS}
            rows={positionRows(load.data)}
            getRowKey={(row) => row.bodyKey}
          />

          {showHouses && (
            <>
              <h2>House cusps</h2>
              <SortableTable
                caption="Houses"
                columns={HOUSE_CUSP_COLUMNS}
                rows={houseCuspRows(load.data)}
                getRowKey={(row) => String(row.house)}
              />
              <SortableTable
                caption="Angles"
                columns={ANGLE_COLUMNS}
                rows={angleRows(load.data)}
                getRowKey={(row) => row.label}
              />
            </>
          )}

          <h2>Aspects</h2>
          <SortableTable
            caption="Aspects"
            columns={ASPECT_COLUMNS}
            rows={aspectRows(load.data)}
            getRowKey={(row) => `${row.bodyAKey}-${row.aspect}-${row.bodyBKey}`}
          />

          <h2>Dignities</h2>
          <SortableTable
            caption="Dignities"
            columns={DIGNITY_COLUMNS}
            rows={dignityRows(load.data)}
            getRowKey={(row) => row.bodyKey}
          />

          {showHouses && (
            <>
              <h2>Derived points</h2>
              <p className="hint">Sect: {load.data.sect === 'day' ? 'Day chart' : 'Night chart'}</p>
              <SortableTable
                caption="Derived points"
                columns={DERIVED_POINT_COLUMNS}
                rows={derivedPointRows(load.data)}
                getRowKey={(row) => row.label}
              />
            </>
          )}
        </>
      )}
    </main>
  );
}
