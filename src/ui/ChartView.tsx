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
 * Ascendant and stay available; the Positions table's own Ascendant/Midheaven
 * rows (folded in from what used to be a separate Angles table, matching
 * Astro-Seek's combined layout) are the one exception, gated by the same
 * `showHouses` flag rather than by the tab itself.
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
  chartSheetInput,
  chartSheetMetaLines,
  derivedPointRows,
  dignityRows,
  houseCuspRows,
  positionRows,
  type AngleRow,
  type AspectRow,
  type DerivedPointRow,
  type DignityRow,
  type HouseCuspRow,
  type PointVisibilityOptions,
  type PositionRow,
} from '../domain/chart-tables.js';
import { computeChartData, type ChartData } from '../domain/chart-compute.js';
import { deriveExportFilename } from '../domain/export-filename.js';
import { encodeChartShareLink } from '../domain/chart-share.js';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';
import { renderChartSheetSvg } from '../chart/chart-sheet.js';
import {
  DEFAULT_EXTENDED_SETTINGS,
  toChartCalculationOptions,
  toPointVisibilityOptions,
  toSignWedgeStyle,
  type ExtendedSettings,
} from '../chart/extended-settings.js';
import { standaloneSvg } from '../chart/standalone-svg.js';
import { resolveWheelDisplayOptions } from '../chart/wheel-options.js';
import { AstroChartWheel } from './AstroChartWheel.js';
import { svgToPngBlob } from './chart-raster.js';
import { downloadBlob, downloadText } from './download.js';
import { ExtendedSettingsPanel } from './ExtendedSettingsPanel.js';
import { ReportView } from './ReportView.js';
import { SortableTable } from './SortableTable.js';
import { useStoreState } from './store-context.js';
import type { TableColumn } from './table-sort.js';
import type { EphemerisProvider } from '../ephemeris/types.js';
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
  { key: 'glyph', label: 'Symbol', valueOf: (row) => row.glyph },
  { key: 'bodyName', label: 'Body', valueOf: (row) => row.bodyName },
  ...degreeColumns<PositionRow>(),
  {
    key: 'house',
    label: 'House',
    valueOf: (row) => row.house ?? '',
    render: (row) => (row.house === undefined ? '—' : String(row.house)),
  },
  {
    key: 'speed',
    label: 'Speed',
    valueOf: (row) => row.speed ?? '',
    render: (row) => (row.speed === undefined ? '—' : row.speed.toFixed(4)),
  },
  {
    key: 'retrograde',
    label: 'Rx',
    valueOf: (row) => row.retrograde ?? false,
    render: (row) => (row.retrograde ? '℞' : ''),
  },
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

/**
 * The table(s) for one non-report tab, factored out of the tab panel below so the same
 * markup can also be stacked for every tab at once in the PDF export (#67) without being
 * duplicated. `undefined` for `'report'`, which isn't a data table and is rendered by its
 * caller instead.
 */
function renderTableTab(
  tab: TabKey,
  data: ChartData,
  displayName: string,
  pointVisibility: PointVisibilityOptions,
  showHouses: boolean,
): React.ReactNode {
  switch (tab) {
    case 'positions':
      return (
        <SortableTable
          caption="Positions"
          columns={POSITION_COLUMNS}
          rows={positionRows(data, pointVisibility, showHouses)}
          getRowKey={(row) => row.bodyKey}
          downloadFilename={deriveExportFilename(displayName, 'positions', 'csv')}
        />
      );
    case 'houses':
      return (
        <>
          <SortableTable
            caption="Houses"
            columns={HOUSE_CUSP_COLUMNS}
            rows={houseCuspRows(data)}
            getRowKey={(row) => String(row.house)}
            downloadFilename={deriveExportFilename(displayName, 'houses', 'csv')}
          />
          <SortableTable
            caption="Angles"
            columns={ANGLE_COLUMNS}
            rows={angleRows(data, pointVisibility)}
            getRowKey={(row) => row.label}
            downloadFilename={deriveExportFilename(displayName, 'angles', 'csv')}
          />
        </>
      );
    case 'aspects':
      return (
        <SortableTable
          caption="Aspects"
          columns={ASPECT_COLUMNS}
          rows={aspectRows(data)}
          getRowKey={(row) => `${row.bodyAKey}-${row.aspect}-${row.bodyBKey}`}
          downloadFilename={deriveExportFilename(displayName, 'aspects', 'csv')}
        />
      );
    case 'dignities':
      return (
        <SortableTable
          caption="Dignities"
          columns={DIGNITY_COLUMNS}
          rows={dignityRows(data, pointVisibility)}
          getRowKey={(row) => row.bodyKey}
          downloadFilename={deriveExportFilename(displayName, 'dignities', 'csv')}
        />
      );
    case 'derived':
      return (
        <>
          <p className="hint">Sect: {data.sect === 'day' ? 'Day chart' : 'Night chart'}</p>
          <SortableTable
            caption="Derived points"
            columns={DERIVED_POINT_COLUMNS}
            rows={derivedPointRows(data, pointVisibility)}
            getRowKey={(row) => row.label}
            downloadFilename={deriveExportFilename(displayName, 'derived-points', 'csv')}
          />
        </>
      );
    case 'report':
      return undefined;
  }
}

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

/** PNG export resolutions (#67): the wheel's own default pixel size, and 2x/4x of it. */
const PNG_SIZES: readonly { readonly label: string; readonly size: number }[] = [
  { label: 'Small (600px)', size: 600 },
  { label: 'Medium (1200px)', size: 1200 },
  { label: 'Large (2400px)', size: 2400 },
];

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
 * The chart sheet and data tables for one computed chart, independent of where the data
 * came from — the local store (`ChartView`) or a decoded share link (`SharedChartView`,
 * #65). Kept separate so both callers get the same tabs, sheet, and loading/error states.
 */
export function ChartDataView({
  load,
  displayName,
  showHouses,
  metaLines,
  extendedSettings = DEFAULT_EXTENDED_SETTINGS,
  onExtendedSettingsChange,
  settingsProvider,
}: {
  readonly load: Load;
  readonly displayName: string;
  readonly showHouses: boolean;
  /**
   * Header lines for the sheet. Passed in rather than derived here because only
   * the caller holds the birth moment the date/place lines come from; omitted,
   * the sheet is headed by the display name alone.
   */
  readonly metaLines?: readonly string[];
  /**
   * The confirmed (post-Redraw) extended settings (#52): house system, zodiac,
   * orb rules, minor aspects, point visibility, and the wheel's sign-wedge
   * style. Defaults to `DEFAULT_EXTENDED_SETTINGS` so `SharedChartView` — which
   * has no panel and doesn't pass any of these three props — renders exactly as
   * it did before this feature existed.
   */
  readonly extendedSettings?: ExtendedSettings;
  /**
   * Set together with `settingsProvider`: when both are given, the "Extended
   * settings" panel is rendered and this is wired as its `onRedraw`. Omitted by
   * `SharedChartView`, which has no panel.
   */
  readonly onExtendedSettingsChange?: (next: ExtendedSettings) => void;
  /** A long-lived provider for the panel's own house-system/ayanamsa name lookups. */
  readonly settingsProvider?: EphemerisProvider | undefined;
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabKey>('positions');
  // Which wheel rendering is on screen. Session-only, not persisted with the chart's
  // other display settings (`resolveWheelDisplayOptions`) — keeping this additive and
  // small rather than growing that settings bag for a first cut. AstroChart is the
  // default per the user's own preference; Astraya's own wheel is the opt-in alternate.
  const [wheelKind, setWheelKind] = useState<'astrochart' | 'astraya'>('astrochart');
  const [pngSize, setPngSize] = useState(PNG_SIZES[1]?.size ?? 1200);
  const [pngError, setPngError] = useState<string | undefined>(undefined);
  const [pngBusy, setPngBusy] = useState(false);
  // True only for the moment between clicking "Export PDF" and the print dialog closing
  // (see `exportPdf` below): while true, every table renders at once instead of just the
  // active tab, so the PDF the browser's own "Save as PDF" produces has all of them (#67).
  const [printAll, setPrintAll] = useState(false);

  const pointVisibility = toPointVisibilityOptions(extendedSettings);

  const sheet = useMemo(() => {
    if (load.kind !== 'ready' || !showHouses) return undefined;
    return renderChartSheetSvg(
      chartSheetInput(
        load.data,
        metaLines ?? [displayName || 'Chart'],
        displayName || 'Natal',
        toPointVisibilityOptions(extendedSettings),
      ),
      {
        ...resolveWheelDisplayOptions({}),
        signWedgeStyle: toSignWedgeStyle(extendedSettings),
      },
    );
  }, [load, showHouses, displayName, metaLines, extendedSettings]);

  useEffect(() => {
    if (!printAll) return undefined;
    // document.title seeds the filename most browsers' print-to-PDF dialogs suggest, so a
    // saved PDF gets the same person-and-chart-derived name as the SVG/CSV downloads do.
    const previousTitle = document.title;
    document.title = deriveExportFilename(displayName, 'chart', 'pdf');
    const restore = (): void => {
      document.title = previousTitle;
      setPrintAll(false);
    };
    window.addEventListener('afterprint', restore, { once: true });
    // Deferred a tick so the all-tables markup this triggers is committed to the DOM
    // before the browser captures the page to print.
    const timer = setTimeout(() => {
      window.print();
    }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('afterprint', restore);
    };
  }, [printAll, displayName]);

  const exportPdf = (): void => {
    setPrintAll(true);
  };

  const downloadSvg = (): void => {
    if (sheet === undefined) return;
    downloadText(deriveExportFilename(displayName, 'chart', 'svg'), standaloneSvg(sheet.markup), 'image/svg+xml');
  };

  const downloadPng = (): void => {
    if (sheet === undefined) return;
    setPngError(undefined);
    setPngBusy(true);
    // The sheet is taller than it is wide, so the chosen size is its width and
    // the height follows its own aspect ratio — rasterizing it square would
    // squash the wheel into an ellipse.
    const pngHeight = Math.round((pngSize * sheet.height) / sheet.width);
    void svgToPngBlob(standaloneSvg(sheet.markup), pngSize, pngHeight)
      .then((blob) => {
        downloadBlob(deriveExportFilename(displayName, 'chart', 'png'), blob);
      })
      .catch((error: unknown) => {
        setPngError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setPngBusy(false);
      });
  };

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

          {onExtendedSettingsChange !== undefined && settingsProvider !== undefined && (
            <ExtendedSettingsPanel
              value={extendedSettings}
              onRedraw={onExtendedSettingsChange}
              provider={settingsProvider}
            />
          )}

          {sheet !== undefined && (
            <>
              <div className="wheel-toggle" role="group" aria-label="Wheel rendering">
                <button
                  type="button"
                  aria-pressed={wheelKind === 'astrochart'}
                  className="quiet"
                  onClick={() => {
                    setWheelKind('astrochart');
                  }}
                >
                  AstroChart
                </button>
                <button
                  type="button"
                  aria-pressed={wheelKind === 'astraya'}
                  className="quiet"
                  onClick={() => {
                    setWheelKind('astraya');
                  }}
                >
                  Astraya
                </button>
              </div>

              {/* "Export PDF" prints whatever is in `.chart-wheel` on the page (#67), so the
                  Astraya rendering is forced here even when AstroChart is the active view —
                  otherwise a PDF export would silently disagree with the on-screen SVG/PNG
                  exports below, which always render from `sheet` regardless of the toggle. */}
              {wheelKind === 'astrochart' && !printAll ? (
                <div className="chart-wheel" aria-hidden="true">
                  <AstroChartWheel data={load.data} signWedgeStyle={toSignWedgeStyle(extendedSettings)} />
                </div>
              ) : (
                <div
                  className="chart-wheel"
                  // Hidden from assistive tech rather than given an aria-label (#69): a chart
                  // wheel packs dozens of positions/aspects into overlapping glyphs, and no short
                  // label does that justice. The data tables right below are the actual accessible
                  // equivalent — they carry every value the wheel draws, as text a screen reader
                  // can read directly.
                  aria-hidden="true"
                  // The wheel is generated entirely by this app from data it just computed — never
                  // user-supplied markup — so injecting it is the same trust boundary as any other
                  // value this component renders, just carried as a string instead of JSX.
                  dangerouslySetInnerHTML={{ __html: sheet.markup }}
                />
              )}

              {wheelKind === 'astrochart' && (
                <p className="hint">
                  Exports below always use Astraya&rsquo;s own rendering, regardless of which wheel is shown here.
                </p>
              )}

              <div className="chart-export-actions">
                <button type="button" className="quiet" onClick={downloadSvg}>
                  Download SVG
                </button>
                <span className="chart-export-png">
                  <select
                    aria-label="PNG resolution"
                    value={pngSize}
                    onChange={(event) => {
                      setPngSize(Number(event.target.value));
                    }}
                  >
                    {PNG_SIZES.map((option) => (
                      <option key={option.size} value={option.size}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="quiet" onClick={downloadPng} disabled={pngBusy}>
                    {pngBusy ? 'Rendering…' : 'Download PNG'}
                  </button>
                </span>
                <button type="button" className="quiet" onClick={exportPdf}>
                  Export PDF&hellip;
                </button>
              </div>
              {pngError !== undefined && (
                <p className="warning" role="alert">
                  {pngError}
                </p>
              )}
              <p className="hint">
                &ldquo;Export PDF&rdquo; opens your browser&rsquo;s print dialog with the wheel and every data table
                laid out for paper &mdash; choose &ldquo;Save as PDF&rdquo; there.
              </p>
            </>
          )}

          {printAll ? (
            <div className="chart-print-all">
              {tabs
                .filter((tab) => tab !== 'report')
                .map((tab) => (
                  <div key={tab}>{renderTableTab(tab, load.data, displayName, pointVisibility, showHouses)}</div>
                ))}
            </div>
          ) : (
            <>
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
                {activeTab === 'report'
                  ? showHouses && <ReportView chart={load.data} />
                  : renderTableTab(activeTab, load.data, displayName, pointVisibility, showHouses)}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

export function ChartView({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [settings, setSettings] = useState<ExtendedSettings>(DEFAULT_EXTENDED_SETTINGS);
  // A separate provider dedicated to the "Extended settings" panel's own house-system/
  // ayanamsa name lookups (#52): created once for the component's lifetime, unlike the
  // provider below, which used to be torn down and recreated on every recompute — reusing
  // that one here would dispose it out from under the panel on every redraw.
  const [settingsProvider, setSettingsProvider] = useState<EphemerisProvider | undefined>(undefined);
  // The main computation provider (#71): also created once, not per recompute. Spawning a
  // worker means recompiling the WASM module and reloading every ephemeris data file from
  // scratch (`SwissEphemerisEngine#doInitialize`) — real, fixed overhead that a settings
  // tweak has no business re-paying. Reuse is safe because every call already carries its
  // own zodiac/observer options rather than relying on state a prior call left behind
  // (`#applyZodiac`/`#flagsFor` in `engine.ts` set sidereal mode and the topocentric
  // observer fresh from each request's own options), and the worker serializes requests
  // through one promise chain, so out-of-order settings changes still resolve in order.
  const [chartProvider, setChartProvider] = useState<EphemerisProvider | undefined>(undefined);

  useEffect(() => {
    const provider = new WorkerEphemerisProvider();
    const effect = { cancelled: false };
    void provider.initialize().then(() => {
      if (!effect.cancelled) setSettingsProvider(provider);
    });
    return () => {
      effect.cancelled = true;
      void provider.dispose();
    };
  }, []);

  useEffect(() => {
    const provider = new WorkerEphemerisProvider();
    const effect = { cancelled: false };
    void provider.initialize().then(() => {
      if (!effect.cancelled) setChartProvider(provider);
    });
    return () => {
      effect.cancelled = true;
      void provider.dispose();
    };
  }, []);

  useEffect(() => {
    if (person?.moment === undefined || chartProvider === undefined) return undefined;
    const moment = person.moment;
    // A mutable holder rather than a `let`, matching `App.tsx`'s own effect below.
    const effect = { cancelled: false };
    setLoad({ kind: 'loading' });

    void (async () => {
      try {
        const data = await computeChartData(moment, chartProvider, toChartCalculationOptions(settings));
        if (!effect.cancelled) setLoad({ kind: 'ready', data });
      } catch (error) {
        if (!effect.cancelled)
          setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      effect.cancelled = true;
    };
  }, [personId, person, settings, chartProvider]);

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
      <ChartDataView
        load={load}
        displayName={person.displayName}
        showHouses={showHouses}
        metaLines={chartSheetMetaLines(person.displayName, person.moment)}
        extendedSettings={settings}
        onExtendedSettingsChange={setSettings}
        settingsProvider={settingsProvider}
      />
    </main>
  );
}
