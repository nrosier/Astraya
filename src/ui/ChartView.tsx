/**
 * The chart wheel (#39/#40/#41/#42, wired into the UI here) plus data tables
 * for every quantity a chart computes (#44).
 *
 * Every number here is recalculated on the fly from the person's stored birth
 * moment — nothing is read from a saved `Chart`, because `Chart` holds no
 * computed positions by design (see `chart.ts`'s own doc comment) and no
 * screen yet exists to create one. `chart-compute.ts` does the one pass over
 * the ephemeris; `chart-tables.ts` shapes the result into the wheel ring and
 * the table rows below.
 *
 * The wheel and the houses/angles/derived-points tables are all built on the
 * Ascendant, so all of them are hidden when `person.timeAccuracy === 'unknown'`
 * — not merely approximated — matching the warning `PersonForm.tsx` already
 * gives about the same person: an unknown birth time makes them meaningless
 * rather than imprecise. Positions, aspects and dignities don't depend on the
 * Ascendant and stay available.
 *
 * The tables are grouped into tabs — one page per concern — rather than
 * stacked, since a chart's full data easily runs to six tables' worth of rows
 * and reading it top-to-bottom on every visit gets in the way of jumping
 * straight to, say, aspects. The WAI-ARIA APG's "manual activation" tabs
 * pattern is small enough to inline here rather than factor into its own
 * component for a single caller.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  angleRows,
  aspectRows,
  chartWheelRing,
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
import { encodeChartShareLink } from '../domain/chart-share.js';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';
import { renderMultiWheelSvg } from '../chart/multi-wheel.js';
import { resolveWheelDisplayOptions } from '../chart/wheel-options.js';
import { ReportView } from './ReportView.js';
import { SortableTable } from './SortableTable.js';
import { useStoreState } from './store-context.js';
import type { TableColumn } from './table-sort.js';
import type { BirthMomentInput } from '../time/types.js';

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

type TabKey = 'positions' | 'houses' | 'aspects' | 'dignities' | 'derived' | 'report';

const TAB_LABELS: Record<TabKey, string> = {
  positions: 'Positions',
  houses: 'Houses',
  aspects: 'Aspects',
  dignities: 'Dignities',
  derived: 'Derived points',
  report: 'Report',
};

/**
 * Every tab in display order; `houses`, `derived` and `report` are dropped by
 * the caller when `!showHouses` — the report's core-identity and houses
 * sections both read the Ascendant, so it is gated the same way those two
 * existing tabs already are, rather than showing a report with a missing
 * first section.
 */
const TAB_ORDER: readonly TabKey[] = ['positions', 'houses', 'aspects', 'dignities', 'derived', 'report'];

/**
 * Copies a #65 share link for one birth moment to the clipboard — the chart itself is
 * always recomputed from `moment` on the recipient's end, so this is the entire payload;
 * nothing is sent anywhere to produce it.
 */
function ShareLink({
  moment,
  housesKnown,
}: {
  readonly moment: BirthMomentInput;
  readonly housesKnown: boolean;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const copy = (): void => {
    const query = encodeChartShareLink({ moment, settings: {}, housesKnown }).toString();
    const url = `${window.location.origin}${window.location.pathname}#/shared?${query}`;
    void navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 2000);
      },
      // A denied clipboard permission leaves the screen exactly as it was; there is
      // nothing else to recover from, so this is deliberately silent.
      () => undefined,
    );
  };

  return (
    <p>
      <button type="button" className="quiet" onClick={copy}>
        {copied ? 'Link copied' : 'Copy share link'}
      </button>{' '}
      <span className="hint">
        The link holds the whole birth record and settings &mdash; nothing is sent to us to create it, and opening it
        needs no account.
      </span>
    </p>
  );
}

/**
 * The wheel and data tables for one computed chart, independent of where the data came
 * from — the local store (`ChartView`) or a decoded share link (`SharedChartView`, #65).
 * Kept separate so both callers get the same tabs, wheel, and loading/error states.
 */
export function ChartDataView({
  load,
  displayName,
  showHouses,
}: {
  readonly load: Load;
  readonly displayName: string;
  readonly showHouses: boolean;
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('positions');

  const wheelSvg = useMemo(() => {
    if (load.kind !== 'ready' || !showHouses) return undefined;
    const ring = chartWheelRing(load.data, displayName || 'Natal');
    return renderMultiWheelSvg([ring], [], resolveWheelDisplayOptions({}));
  }, [load, showHouses, displayName]);

  const tabs = showHouses
    ? TAB_ORDER
    : TAB_ORDER.filter((tab) => tab !== 'houses' && tab !== 'derived' && tab !== 'report');

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const currentIndex = tabs.indexOf(activeTab);
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    if (next === undefined) return;
    setActiveTab(next);
    document.getElementById(`chart-tab-${next}`)?.focus();
  };

  return (
    <>
      {!showHouses && (
        <p className="hint">
          The birth time for {displayName || 'this person'} is unknown, so houses, angles and the Ascendant-based
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

          {wheelSvg !== undefined && (
            <div
              className="chart-wheel"
              // The wheel is generated entirely by this app from data it just computed — never
              // user-supplied markup — so injecting it is the same trust boundary as any other
              // value this component renders, just carried as a string instead of JSX.
              dangerouslySetInnerHTML={{ __html: wheelSvg }}
            />
          )}

          <div className="tabs" role="tablist" aria-label="Chart data" onKeyDown={onTabKeyDown}>
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                id={`chart-tab-${tab}`}
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls={`chart-tabpanel-${tab}`}
                tabIndex={activeTab === tab ? 0 : -1}
                className={activeTab === tab ? 'tab active' : 'tab'}
                onClick={() => {
                  setActiveTab(tab);
                }}
              >
                {TAB_LABELS[tab]}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id={`chart-tabpanel-${activeTab}`}
            aria-labelledby={`chart-tab-${activeTab}`}
            tabIndex={0}
          >
            {activeTab === 'positions' && (
              <SortableTable
                caption="Positions"
                columns={POSITION_COLUMNS}
                rows={positionRows(load.data)}
                getRowKey={(row) => row.bodyKey}
              />
            )}

            {activeTab === 'houses' && showHouses && (
              <>
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

            {activeTab === 'aspects' && (
              <SortableTable
                caption="Aspects"
                columns={ASPECT_COLUMNS}
                rows={aspectRows(load.data)}
                getRowKey={(row) => `${row.bodyAKey}-${row.aspect}-${row.bodyBKey}`}
              />
            )}

            {activeTab === 'dignities' && (
              <SortableTable
                caption="Dignities"
                columns={DIGNITY_COLUMNS}
                rows={dignityRows(load.data)}
                getRowKey={(row) => row.bodyKey}
              />
            )}

            {activeTab === 'derived' && showHouses && (
              <>
                <p className="hint">Sect: {load.data.sect === 'day' ? 'Day chart' : 'Night chart'}</p>
                <SortableTable
                  caption="Derived points"
                  columns={DERIVED_POINT_COLUMNS}
                  rows={derivedPointRows(load.data)}
                  getRowKey={(row) => row.label}
                />
              </>
            )}

            {activeTab === 'report' && showHouses && <ReportView chart={load.data} />}
          </div>
        </>
      )}
    </>
  );
}

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
      <ShareLink moment={person.moment} housesKnown={showHouses} />
      <ChartDataView load={load} displayName={person.displayName} showHouses={showHouses} />
    </main>
  );
}
