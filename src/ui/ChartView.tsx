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
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  almutenOfAscendant,
  angleRows,
  antisciaRows,
  aspectRows,
  chartShapeOf,
  chartSheetInput,
  chartSheetMetaLines,
  declinationContactRows,
  derivedPointRows,
  dignityRows,
  dispositorRows,
  fixedStarRows,
  houseCuspRows,
  positionRows,
  visiblePositions,
  type AngleRow,
  type AntisciaRow,
  type AspectRow,
  type DeclinationContactRow,
  type DerivedPointRow,
  type DignityRow,
  type DispositorRow,
  type FixedStarRow,
  type HouseCuspRow,
  type PointVisibilityOptions,
  type PositionRow,
} from '../domain/chart-tables.js';
import { computeChartData, housesAreDefined, type ChartData } from '../domain/chart-compute.js';
import { deriveExportFilename } from '../domain/export-filename.js';
import { encodeChartShareLink } from '../domain/chart-share.js';
import { momentKey } from '../time/encode.js';
import { renderChartSheetSvg } from '../chart/chart-sheet.js';
import { renderJonesShapeDiagramSvg } from '../chart/jones-shape-diagram.js';
import { lunarPhaseOf } from '../astrology/lunar-phase.js';
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
import { bodyById, bodyByKey } from '../astrology/bodies.js';
import { aspectDisplayName, bodyDisplayName, signDisplayName } from './astro-names.messages.js';
import { chartViewMessages } from './ChartView.messages.js';
import { svgToPngBlob } from './chart-raster.js';
import { downloadBlob, downloadText } from './download.js';
import { useEphemerisProvider } from './EphemerisProviderContext.js';
import { ExtendedSettingsPanel } from './ExtendedSettingsPanel.js';
import { useLocale } from './locale.js';
import { useMessages } from './messages.js';
import { WheelSelectionText } from './WheelSelectionText.js';
import { PersonNotFound } from './PersonNotFound.js';
import { SortableTable } from './SortableTable.js';
import { useStoreState } from './store-context.js';
import type { TableColumn } from './table-sort.js';
import type { BodyId, EphemerisProvider } from '../ephemeris/types.js';
import type { Locale } from '../interpretation/schema.js';
import type { BirthMomentInput } from '../time/types.js';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: ChartData }
  | { readonly kind: 'error'; readonly message: string };

const degreeColumns = <
  T extends { readonly sign: string; readonly degree: number; readonly minute: number; readonly second: number },
>(
  t: typeof chartViewMessages.en,
  locale: Locale,
): readonly TableColumn<T>[] => [
  {
    key: 'sign',
    label: t.signLabel,
    valueOf: (row) => row.sign,
    render: (row) => signDisplayName(row.sign, locale),
  },
  { key: 'degree', label: t.degLabel, valueOf: (row) => row.degree },
  { key: 'minute', label: t.minLabel, valueOf: (row) => row.minute },
  { key: 'second', label: t.secLabel, valueOf: (row) => row.second },
];

function positionColumns(t: typeof chartViewMessages.en, locale: Locale): readonly TableColumn<PositionRow>[] {
  return [
    { key: 'glyph', label: t.symbolLabel, valueOf: (row) => row.glyph },
    {
      key: 'bodyName',
      label: t.bodyLabel,
      valueOf: (row) => row.bodyName,
      render: (row) => bodyDisplayName(row.bodyKey, locale),
    },
    ...degreeColumns<PositionRow>(t, locale),
    {
      key: 'house',
      label: t.houseLabel,
      valueOf: (row) => row.house ?? '',
      render: (row) => (row.house === undefined ? '—' : String(row.house)),
    },
    {
      key: 'speed',
      label: t.speedLabel,
      valueOf: (row) => row.speed ?? '',
      render: (row) => (row.speed === undefined ? '—' : row.speed.toFixed(4)),
    },
    {
      key: 'retrograde',
      label: t.rxLabel,
      valueOf: (row) => row.retrograde ?? false,
      render: (row) => (row.retrograde ? '℞' : ''),
    },
    {
      key: 'anaretic',
      label: t.anareticLabel,
      valueOf: (row) => row.anaretic,
      render: (row) => (row.anaretic ? '✓' : ''),
    },
    {
      key: 'outOfBounds',
      label: t.outOfBoundsLabel,
      valueOf: (row) => row.outOfBounds ?? false,
      render: (row) => (row.outOfBounds === true ? '✓' : ''),
    },
  ];
}

function houseCuspColumns(t: typeof chartViewMessages.en, locale: Locale): readonly TableColumn<HouseCuspRow>[] {
  return [
    { key: 'house', label: t.houseLabel, valueOf: (row) => row.house },
    ...degreeColumns<HouseCuspRow>(t, locale),
  ];
}

function angleColumns(t: typeof chartViewMessages.en, locale: Locale): readonly TableColumn<AngleRow>[] {
  return [{ key: 'label', label: t.angleLabel, valueOf: (row) => row.label }, ...degreeColumns<AngleRow>(t, locale)];
}

function aspectColumns(t: typeof chartViewMessages.en, locale: Locale): readonly TableColumn<AspectRow>[] {
  return [
    {
      key: 'bodyAName',
      label: t.bodyALabel,
      valueOf: (row) => row.bodyAName,
      render: (row) => bodyDisplayName(row.bodyAKey, locale),
    },
    {
      key: 'aspect',
      label: t.aspectLabel,
      valueOf: (row) => row.aspect,
      render: (row) => aspectDisplayName(row.aspectKey, locale),
    },
    {
      key: 'bodyBName',
      label: t.bodyBLabel,
      valueOf: (row) => row.bodyBName,
      render: (row) => bodyDisplayName(row.bodyBKey, locale),
    },
    { key: 'orb', label: t.orbLabel, valueOf: (row) => row.orb, render: (row) => `${row.orb.toFixed(2)}°` },
    {
      key: 'applying',
      label: t.applyingLabel,
      valueOf: (row) => row.applying,
      render: (row) => (row.applying ? t.applying : t.separating),
    },
  ];
}

function dignityColumns(t: typeof chartViewMessages.en, locale: Locale): readonly TableColumn<DignityRow>[] {
  return [
    {
      key: 'bodyName',
      label: t.bodyLabel,
      valueOf: (row) => row.bodyName,
      render: (row) => bodyDisplayName(row.bodyKey, locale),
    },
    { key: 'ruler', label: t.rulerLabel, valueOf: (row) => row.ruler, render: (row) => (row.ruler ? '✓' : '') },
    {
      key: 'exalted',
      label: t.exaltedLabel,
      valueOf: (row) => row.exalted,
      render: (row) => (row.exalted ? '✓' : ''),
    },
    {
      key: 'detriment',
      label: t.detrimentLabel,
      valueOf: (row) => row.detriment,
      render: (row) => (row.detriment ? '✓' : ''),
    },
    { key: 'fall', label: t.fallLabel, valueOf: (row) => row.fall, render: (row) => (row.fall ? '✓' : '') },
    {
      key: 'triplicity',
      label: t.triplicityLabel,
      valueOf: (row) => row.triplicity,
      render: (row) => (row.triplicity ? '✓' : ''),
    },
    { key: 'bound', label: t.boundLabel, valueOf: (row) => row.bound, render: (row) => (row.bound ? '✓' : '') },
    { key: 'face', label: t.faceLabel, valueOf: (row) => row.face, render: (row) => (row.face ? '✓' : '') },
    { key: 'points', label: t.dignityPointsLabel, valueOf: (row) => row.points },
    {
      key: 'peregrine',
      label: t.peregrineLabel,
      valueOf: (row) => row.peregrine,
      render: (row) => (row.peregrine ? '✓' : ''),
    },
  ];
}

function dispositorColumns(t: typeof chartViewMessages.en, locale: Locale): readonly TableColumn<DispositorRow>[] {
  return [
    {
      key: 'bodyName',
      label: t.bodyLabel,
      valueOf: (row) => row.bodyName,
      render: (row) => bodyDisplayName(row.bodyKey, locale),
    },
    {
      key: 'chain',
      label: t.chainLabel,
      valueOf: (row) => row.chain.join(' '),
      render: (row) => row.chain.map((key) => bodyDisplayName(key, locale)).join(' → '),
    },
    {
      key: 'finalDispositorName',
      label: t.finalDispositorLabel,
      valueOf: (row) => row.finalDispositorName ?? '',
      render: (row) => (row.finalDispositorKey === undefined ? '—' : bodyDisplayName(row.finalDispositorKey, locale)),
    },
    { key: 'cycle', label: t.cycleLabel, valueOf: (row) => row.cycle, render: (row) => (row.cycle ? '✓' : '') },
    {
      key: 'mutualReception',
      label: t.mutualReceptionLabel,
      valueOf: (row) => row.mutualReception,
      render: (row) => (row.mutualReception ? '✓' : ''),
    },
  ];
}

function declinationColumns(
  t: typeof chartViewMessages.en,
  locale: Locale,
): readonly TableColumn<DeclinationContactRow>[] {
  return [
    {
      key: 'bodyAName',
      label: t.bodyALabel,
      valueOf: (row) => row.bodyAName,
      render: (row) => bodyDisplayName(row.bodyAKey, locale),
    },
    {
      key: 'bodyBName',
      label: t.bodyBLabel,
      valueOf: (row) => row.bodyBName,
      render: (row) => bodyDisplayName(row.bodyBKey, locale),
    },
    { key: 'kind', label: t.kindLabel, valueOf: (row) => row.kind, render: (row) => t[row.kind] },
    { key: 'orb', label: t.orbLabel, valueOf: (row) => row.orb, render: (row) => `${row.orb.toFixed(2)}°` },
  ];
}

function antisciaColumns(t: typeof chartViewMessages.en, locale: Locale): readonly TableColumn<AntisciaRow>[] {
  return [
    {
      key: 'bodyName',
      label: t.bodyLabel,
      valueOf: (row) => row.bodyName,
      render: (row) => bodyDisplayName(row.bodyKey, locale),
    },
    {
      key: 'contactName',
      label: t.contactLabel,
      valueOf: (row) => row.contactName,
      render: (row) => bodyDisplayName(row.contactKey, locale),
    },
    {
      key: 'kind',
      label: t.kindLabel,
      valueOf: (row) => row.kind,
      render: (row) => (row.kind === 'antiscion' ? t.antiscion : t.contraAntiscion),
    },
    { key: 'orb', label: t.orbLabel, valueOf: (row) => row.orb, render: (row) => `${row.orb.toFixed(2)}°` },
  ];
}

function fixedStarColumns(t: typeof chartViewMessages.en, locale: Locale): readonly TableColumn<FixedStarRow>[] {
  return [
    // Star names (Regulus, Spica, ...) are proper nouns, the same in both locales — no glossary
    // lookup needed, unlike body/aspect names.
    { key: 'star', label: t.starLabel, valueOf: (row) => row.star },
    {
      key: 'bodyName',
      label: t.bodyLabel,
      valueOf: (row) => row.bodyName,
      render: (row) => bodyDisplayName(row.bodyKey, locale),
    },
    { key: 'orb', label: t.orbLabel, valueOf: (row) => row.orb, render: (row) => `${row.orb.toFixed(2)}°` },
  ];
}

function derivedPointColumns(t: typeof chartViewMessages.en, locale: Locale): readonly TableColumn<DerivedPointRow>[] {
  return [
    { key: 'label', label: t.pointLabel, valueOf: (row) => row.label },
    ...degreeColumns<DerivedPointRow>(t, locale),
  ];
}

type TabKey = 'positions' | 'houses' | 'aspects' | 'dignities' | 'derived';

/**
 * The table(s) for one tab, factored out of the tab panel below so the same markup can also
 * be stacked for every tab at once in the PDF export (#67) without being duplicated.
 */
function renderTableTab(
  tab: TabKey,
  data: ChartData,
  displayName: string,
  pointVisibility: PointVisibilityOptions,
  showHouses: boolean,
  t: typeof chartViewMessages.en,
  locale: Locale,
): React.ReactNode {
  switch (tab) {
    case 'positions': {
      const shape = chartShapeOf(data, pointVisibility);
      const shapePositions = new Map(
        visiblePositions(data.positions, pointVisibility).map((position) => [position.body, position.longitude]),
      );
      const sunBody = bodyByKey('sun');
      const moonBody = bodyByKey('moon');
      const sunLongitude = data.positions.find((position) => position.body === sunBody?.id)?.longitude;
      const moonLongitude = data.positions.find((position) => position.body === moonBody?.id)?.longitude;
      const lunarPhase =
        sunLongitude === undefined || moonLongitude === undefined
          ? undefined
          : lunarPhaseOf(moonLongitude, sunLongitude);
      return (
        <>
          {lunarPhase !== undefined && (
            <p className="hint lunar-phase-summary">
              {t.lunarPhaseSentence(
                t.lunarPhaseLabels[lunarPhase.phase],
                formatElongation(lunarPhase.elongation),
                lunarPhase.waxing,
                Math.round(lunarPhase.illumination * 100),
              )}
            </p>
          )}
          {shape !== undefined && (
            <div className="chart-shape-summary">
              <p className="hint">
                {t.chartShapeSentence(
                  t.jonesShapeLabels[shape.shape],
                  shape.handle === undefined ? undefined : bodyDisplayName(bodyById(shape.handle)?.key ?? '', locale),
                )}
              </p>
              <div
                className="chart-shape-diagram-wrap"
                aria-hidden="true"
                dangerouslySetInnerHTML={{ __html: renderJonesShapeDiagramSvg(shape, shapePositions, 140) }}
              />
            </div>
          )}
          <SortableTable
            caption={t.positionsCaption}
            columns={positionColumns(t, locale)}
            rows={positionRows(data, pointVisibility, showHouses)}
            getRowKey={(row) => row.bodyKey}
            downloadFilename={deriveExportFilename(displayName, 'positions', 'csv')}
          />
        </>
      );
    }
    case 'houses':
      return (
        <>
          <SortableTable
            caption={t.housesCaption}
            columns={houseCuspColumns(t, locale)}
            rows={houseCuspRows(data)}
            getRowKey={(row) => String(row.house)}
            downloadFilename={deriveExportFilename(displayName, 'houses', 'csv')}
          />
          <SortableTable
            caption={t.anglesCaption}
            columns={angleColumns(t, locale)}
            rows={angleRows(data, pointVisibility)}
            getRowKey={(row) => row.label}
            downloadFilename={deriveExportFilename(displayName, 'angles', 'csv')}
          />
        </>
      );
    case 'aspects': {
      const declinationRows = declinationContactRows(data);
      const antiscionRows = antisciaRows(data);
      const starRows = fixedStarRows(data, pointVisibility);
      return (
        <>
          <SortableTable
            caption={t.aspectsCaption}
            columns={aspectColumns(t, locale)}
            rows={aspectRows(data)}
            getRowKey={(row) => `${row.bodyAKey}-${row.aspect}-${row.bodyBKey}`}
            downloadFilename={deriveExportFilename(displayName, 'aspects', 'csv')}
          />
          {antiscionRows.length > 0 && (
            <SortableTable
              caption={t.antisciaCaption}
              columns={antisciaColumns(t, locale)}
              rows={antiscionRows}
              getRowKey={(row) => `${row.bodyKey}-${row.kind}-${row.contactKey}`}
              downloadFilename={deriveExportFilename(displayName, 'antiscia', 'csv')}
            />
          )}
          {declinationRows.length > 0 && (
            <SortableTable
              caption={t.declinationsCaption}
              columns={declinationColumns(t, locale)}
              rows={declinationRows}
              getRowKey={(row) => `${row.bodyAKey}-${row.kind}-${row.bodyBKey}`}
              downloadFilename={deriveExportFilename(displayName, 'declinations', 'csv')}
            />
          )}
          {starRows.length > 0 && (
            <SortableTable
              caption={t.fixedStarsCaption}
              columns={fixedStarColumns(t, locale)}
              rows={starRows}
              getRowKey={(row) => `${row.star}-${row.bodyKey}`}
              downloadFilename={deriveExportFilename(displayName, 'fixed-stars', 'csv')}
            />
          )}
        </>
      );
    }
    case 'dignities': {
      const almuten = almutenOfAscendant(data);
      return (
        <>
          {almuten !== undefined && (
            <p className="hint">
              {t.almutenOfAscendantSentence(almuten.almutens.map((key) => bodyDisplayName(key, locale)).join(', '))}
            </p>
          )}
          <SortableTable
            caption={t.dignitiesCaption}
            columns={dignityColumns(t, locale)}
            rows={dignityRows(data, pointVisibility)}
            getRowKey={(row) => row.bodyKey}
            downloadFilename={deriveExportFilename(displayName, 'dignities', 'csv')}
          />
          <SortableTable
            caption={t.dispositorsCaption}
            columns={dispositorColumns(t, locale)}
            rows={dispositorRows(data, pointVisibility)}
            getRowKey={(row) => row.bodyKey}
            downloadFilename={deriveExportFilename(displayName, 'dispositors', 'csv')}
          />
        </>
      );
    }
    case 'derived':
      return (
        <>
          <p className="hint">
            {t.sectPrefix} {data.sect === 'day' ? t.dayChart : t.nightChart}
          </p>
          <SortableTable
            caption={t.derivedPointsCaption}
            columns={derivedPointColumns(t, locale)}
            rows={derivedPointRows(data, pointVisibility)}
            getRowKey={(row) => row.label}
            downloadFilename={deriveExportFilename(displayName, 'derived-points', 'csv')}
          />
        </>
      );
  }
}

function tabLabels(t: typeof chartViewMessages.en): Record<TabKey, string> {
  return {
    positions: t.positionsCaption,
    houses: t.housesCaption,
    aspects: t.aspectsCaption,
    dignities: t.dignitiesCaption,
    derived: t.derivedPointsCaption,
  };
}

/** Every tab in display order; `houses` and `derived` are dropped by the caller when `!showHouses`. */
const TAB_ORDER: readonly TabKey[] = ['positions', 'houses', 'aspects', 'dignities', 'derived'];

/** PNG export resolutions (#67): the wheel's own default pixel size, and 2x/4x of it. */
function pngSizes(t: typeof chartViewMessages.en): readonly { readonly label: string; readonly size: number }[] {
  return [
    { label: t.pngSmall, size: 600 },
    { label: t.pngMedium, size: 1200 },
    { label: t.pngLarge, size: 2400 },
  ];
}

/** `337°28'`: an elongation to the minute, the way Astro-Seek prints it beside the phase name. */
function formatElongation(elongation: number): string {
  const totalMinutes = Math.round(elongation * 60) % (360 * 60);
  return `${String(Math.floor(totalMinutes / 60))}°${String(totalMinutes % 60).padStart(2, '0')}'`;
}

function bodyKeyOf(body: BodyId): string {
  return bodyById(body)?.key ?? String(body);
}

function pairKeyOf(a: string, b: string): string {
  return [a, b].sort().join('|');
}

/**
 * Click-to-isolate (#400, #412): what's currently clicked on the wheel, and everything derived
 * from it — which body, sign and aspect-pair keys stay at full strength, plus the focused-info
 * content. A mouse/touch-only enhancement layered on an already-`aria-hidden` wheel (see the
 * wheel div's own doc comment) — not a keyboard-accessible widget, since the data tables already
 * are the accessible path to every value this exposes.
 */
interface WheelIsolation {
  readonly bodies: ReadonlySet<string>;
  readonly signs: ReadonlySet<string>;
  readonly pairs: ReadonlySet<string>;
  readonly heading: string;
  readonly positionRow?: PositionRow | undefined;
  readonly relatedAspects: readonly AspectRow[];
  readonly aspectRow?: AspectRow | undefined;
  /** For a clicked sign: the bodies drawn in it. */
  readonly bodiesInSign?: readonly PositionRow[] | undefined;
}

/** `data-sign` on the wheel is the sign's name lowercased (`multi-wheel.ts`). */
function signKeyOf(row: PositionRow): string {
  return row.sign.toLowerCase();
}

/** `isolatedKey` is `body:<bodyKey>`, `sign:<signKey>` or `aspect:<bodyKeyA>|<bodyKeyB>` (sorted) — see `handleWheelClick`. */
function resolveWheelIsolation(
  isolatedKey: string,
  data: ChartData,
  pointVisibility: PointVisibilityOptions,
  housesRenderable: boolean,
  locale: Locale,
): WheelIsolation | undefined {
  const colonIndex = isolatedKey.indexOf(':');
  if (colonIndex === -1) return undefined;
  const kind = isolatedKey.slice(0, colonIndex);
  const value = isolatedKey.slice(colonIndex + 1);
  const allPositions = positionRows(data, pointVisibility, housesRenderable);
  const allAspects = aspectRows(data);
  const signOfBody = new Map(allPositions.map((row) => [row.bodyKey, signKeyOf(row)]));

  /** The given bodies, every body aspecting one of them, and those aspect pairs. */
  function connectionsOf(focus: ReadonlySet<string>): { bodies: Set<string>; pairs: Set<string> } {
    const bodies = new Set(focus);
    const pairs = new Set<string>();
    for (const aspect of data.aspects) {
      const a = bodyKeyOf(aspect.bodyA);
      const b = bodyKeyOf(aspect.bodyB);
      if (!focus.has(a) && !focus.has(b)) continue;
      bodies.add(a);
      bodies.add(b);
      pairs.add(pairKeyOf(a, b));
    }
    return { bodies, pairs };
  }

  if (kind === 'body') {
    const { bodies, pairs } = connectionsOf(new Set([value]));
    const positionRow = allPositions.find((row) => row.bodyKey === value);
    const relatedAspects = allAspects.filter((row) => row.bodyAKey === value || row.bodyBKey === value);
    const sign = signOfBody.get(value);
    return {
      bodies,
      signs: new Set(sign === undefined ? [] : [sign]),
      pairs,
      heading: positionRow !== undefined ? bodyDisplayName(positionRow.bodyKey, locale) : value,
      positionRow,
      relatedAspects,
    };
  }

  if (kind === 'sign') {
    // Bodies only — the Ascendant/Midheaven rows have no daily motion (see `PositionRow.speed`).
    const inSign = allPositions.filter((row) => row.speed !== undefined && signKeyOf(row) === value);
    const { bodies, pairs } = connectionsOf(new Set(inSign.map((row) => row.bodyKey)));
    const signRow = inSign[0];
    const signName = signRow !== undefined ? signRow.sign : value.charAt(0).toUpperCase() + value.slice(1);
    return {
      bodies,
      signs: new Set([value]),
      pairs,
      heading: signDisplayName(signName, locale),
      relatedAspects: allAspects.filter((row) => pairs.has(pairKeyOf(row.bodyAKey, row.bodyBKey))),
      bodiesInSign: inSign,
    };
  }

  const [bodyAKey, bodyBKey] = value.split('|');
  if (bodyAKey === undefined || bodyBKey === undefined) return undefined;
  const aspectRow = allAspects.find(
    (row) =>
      (row.bodyAKey === bodyAKey && row.bodyBKey === bodyBKey) ||
      (row.bodyAKey === bodyBKey && row.bodyBKey === bodyAKey),
  );
  const bodyAName = aspectRow !== undefined ? bodyDisplayName(aspectRow.bodyAKey, locale) : bodyAKey;
  const bodyBName = aspectRow !== undefined ? bodyDisplayName(aspectRow.bodyBKey, locale) : bodyBKey;
  const signs = [signOfBody.get(bodyAKey), signOfBody.get(bodyBKey)].filter((sign) => sign !== undefined);
  return {
    bodies: new Set([bodyAKey, bodyBKey]),
    signs: new Set(signs),
    pairs: new Set([pairKeyOf(bodyAKey, bodyBKey)]),
    heading: `${bodyAName} – ${bodyBName}`,
    relatedAspects: [],
    aspectRow,
  };
}

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
  const t = useMessages(chartViewMessages);
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
    <>
      <p>
        <button type="button" className="quiet" onClick={copy}>
          {copied ? t.linkCopied : t.copyShareLink}
        </button>{' '}
        <span className="hint">{t.shareLinkHint}</span>
      </p>
      {/* `.warning`, not the `.hint` above it (#341). There is no server-side state behind
          a share link, so there is nothing to revoke — the only place that can be said is
          before the link exists, and grey small print is how it would be missed. */}
      <p className="warning share-warning">{t.shareLinkWarning}</p>
    </>
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
  const t = useMessages(chartViewMessages);
  const [locale] = useLocale();
  const [activeTab, setActiveTab] = useState<TabKey>('positions');
  const [pngSize, setPngSize] = useState(1200);
  const [pngError, setPngError] = useState<string | undefined>(undefined);
  const [pngBusy, setPngBusy] = useState(false);
  // True only for the moment between clicking "Export PDF" and the print dialog closing
  // (see `exportPdf` below): while true, every table renders at once instead of just the
  // active tab, so the PDF the browser's own "Save as PDF" produces has all of them (#67).
  const [printAll, setPrintAll] = useState(false);
  const sizes = pngSizes(t);

  const pointVisibility = toPointVisibilityOptions(extendedSettings);

  // #378: `showHouses` alone (passed in from `person.timeAccuracy`) isn't enough — a *known*
  // birth time at a latitude where the chosen house system has no solution still produces
  // `HousePositions`, just one whose cusps/angles are `NaN` (see `housesAreDefined`'s own doc
  // comment). `housesComputed` stays `true` before `load` is ready so it never itself suppresses
  // anything ahead of data actually arriving; `housesRenderable` is what every house-dependent
  // render below should gate on instead of the raw `showHouses` prop.
  const housesComputed = load.kind !== 'ready' || housesAreDefined(load.data.houses);
  const housesRenderable = showHouses && housesComputed;

  const sheet = useMemo(() => {
    if (load.kind !== 'ready' || !housesRenderable) return undefined;
    return renderChartSheetSvg(
      chartSheetInput(
        load.data,
        metaLines ?? [displayName || t.chartFallback],
        displayName || t.natalFallback,
        toPointVisibilityOptions(extendedSettings),
        (bodyKey) => bodyDisplayName(bodyKey, locale),
      ),
      {
        ...resolveWheelDisplayOptions({}),
        signWedgeStyle: toSignWedgeStyle(extendedSettings),
      },
    );
  }, [load, housesRenderable, displayName, metaLines, extendedSettings, t, locale]);

  // Click-to-isolate (#400). `wheelRef` is the delegation point: the wheel's markup is a raw
  // injected string, not JSX, so individual glyphs/aspect lines can't carry their own `onClick`.
  const wheelRef = useRef<HTMLDivElement>(null);
  const [isolatedKey, setIsolatedKey] = useState<string | undefined>(undefined);

  // A new sheet (redraw, person change, settings change) may no longer contain the previously
  // clicked element at all — clear rather than risk pointing at something that no longer exists.
  useEffect(() => {
    setIsolatedKey(undefined);
  }, [sheet]);

  const isolation = useMemo(() => {
    if (isolatedKey === undefined || load.kind !== 'ready') return undefined;
    return resolveWheelIsolation(isolatedKey, load.data, pointVisibility, housesRenderable, locale);
  }, [isolatedKey, load, pointVisibility, housesRenderable, locale]);

  // Applies the dim/highlight split directly to the injected DOM (the only option: these
  // elements are raw HTML, not React-rendered, so no amount of state can re-render their own
  // classes). `g.chart-dimmed`/`line.chart-dimmed` in app.css outrank the aspect-family color
  // rules by specificity (element + class beats class alone) regardless of source order.
  useEffect(() => {
    const root = wheelRef.current;
    if (root === null) return;
    for (const element of root.querySelectorAll('[data-body]')) {
      const key = element.getAttribute('data-body') ?? '';
      element.classList.toggle('chart-dimmed', isolation !== undefined && !isolation.bodies.has(key));
    }
    for (const element of root.querySelectorAll('[data-sign]')) {
      const key = element.getAttribute('data-sign') ?? '';
      element.classList.toggle('chart-dimmed', isolation !== undefined && !isolation.signs.has(key));
    }
    for (const element of root.querySelectorAll('[data-aspect-body-a]')) {
      const a = element.getAttribute('data-aspect-body-a') ?? '';
      const b = element.getAttribute('data-aspect-body-b') ?? '';
      element.classList.toggle('chart-dimmed', isolation !== undefined && !isolation.pairs.has(pairKeyOf(a, b)));
    }
  }, [isolation, sheet]);

  const handleWheelClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target as Element;
    const bodyEl = target.closest('[data-body]');
    const signEl = bodyEl === null ? target.closest('[data-sign]') : null;
    const aspectEl = bodyEl === null && signEl === null ? target.closest('[data-aspect-body-a]') : null;
    let nextKey: string | undefined;
    if (bodyEl !== null) {
      nextKey = `body:${bodyEl.getAttribute('data-body') ?? ''}`;
    } else if (signEl !== null) {
      nextKey = `sign:${signEl.getAttribute('data-sign') ?? ''}`;
    } else if (aspectEl !== null) {
      const a = aspectEl.getAttribute('data-aspect-body-a') ?? '';
      const b = aspectEl.getAttribute('data-aspect-body-b') ?? '';
      nextKey = `aspect:${pairKeyOf(a, b)}`;
    }
    setIsolatedKey((current) => (current === nextKey ? undefined : nextKey));
  };

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

  const tabs: readonly TabKey[] = housesRenderable
    ? TAB_ORDER
    : TAB_ORDER.filter((tab) => tab !== 'houses' && tab !== 'derived');

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
      {!showHouses && <p className="hint">{t.housesUnknownHint(displayName || t.thisPerson)}</p>}
      {showHouses && !housesComputed && <p className="hint">{t.housesUndefinedHint(displayName || t.thisPerson)}</p>}

      {load.kind === 'loading' && <p className="status">{t.calculating}</p>}

      {load.kind === 'error' && (
        <p className="warning" role="alert">
          {t.chartError(load.message)}
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
              <p className="hint chart-wheel-hint">{t.wheelClickHint}</p>
              <div
                ref={wheelRef}
                className="chart-wheel chart-wheel-interactive"
                // Hidden from assistive tech rather than given an aria-label (#69): a chart
                // wheel packs dozens of positions/aspects into overlapping glyphs, and no short
                // label does that justice. The data tables right below are the actual accessible
                // equivalent — they carry every value the wheel draws, as text a screen reader
                // can read directly. Click-to-isolate (#400) stays a mouse/touch-only
                // enhancement layered on top of that decision, not a reason to revisit it: the
                // tables remain the one accessible path to every value the wheel draws, clicked
                // or not.
                aria-hidden="true"
                // The wheel is generated entirely by this app from data it just computed — never
                // user-supplied markup — so injecting it is the same trust boundary as any other
                // value this component renders, just carried as a string instead of JSX.
                dangerouslySetInnerHTML={{ __html: sheet.markup }}
                onClick={handleWheelClick}
              />

              {isolation !== undefined && (
                <div className="chart-isolation-panel">
                  <div className="chart-isolation-head">
                    <strong>{isolation.heading}</strong>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => {
                        setIsolatedKey(undefined);
                      }}
                    >
                      {t.isolationClear}
                    </button>
                  </div>
                  {isolation.bodiesInSign !== undefined &&
                    (isolation.bodiesInSign.length === 0 ? (
                      <p className="hint">{t.isolationSignEmpty}</p>
                    ) : (
                      <p>
                        {isolation.bodiesInSign
                          .map(
                            (row) =>
                              `${bodyDisplayName(row.bodyKey, locale)} ${String(row.degree)}°${String(row.minute).padStart(2, '0')}'`,
                          )
                          .join(', ')}
                      </p>
                    ))}
                  {isolation.positionRow !== undefined && (
                    <p>
                      {signDisplayName(isolation.positionRow.sign, locale)} {isolation.positionRow.degree}°
                      {String(isolation.positionRow.minute).padStart(2, '0')}'
                      {isolation.positionRow.house !== undefined && ` — ${t.houseLabel} ${isolation.positionRow.house}`}
                    </p>
                  )}
                  {isolation.relatedAspects.length > 0 && (
                    <ul>
                      {isolation.relatedAspects.map((row) => {
                        const otherKey = row.bodyAKey === isolation.positionRow?.bodyKey ? row.bodyBKey : row.bodyAKey;
                        const otherName = bodyDisplayName(otherKey, locale);
                        return (
                          <li key={`${row.bodyAKey}-${row.aspectKey}-${row.bodyBKey}`}>
                            {aspectDisplayName(row.aspectKey, locale)} {otherName} ({row.orb.toFixed(2)}°,{' '}
                            {row.applying ? t.applying : t.separating})
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {isolation.aspectRow !== undefined && (
                    <p>
                      {aspectDisplayName(isolation.aspectRow.aspectKey, locale)} — {t.orbLabel}{' '}
                      {isolation.aspectRow.orb.toFixed(2)}°, {isolation.aspectRow.applying ? t.applying : t.separating}
                    </p>
                  )}
                  {isolatedKey !== undefined && (
                    <WheelSelectionText chart={load.data} selectionKey={isolatedKey} locale={locale} />
                  )}
                </div>
              )}

              {/* AstroChart is a reference rendering kept alongside Astraya's own wheel so the
                  two can be compared during development (#231) — production users only ever
                  see Astraya's, and it never participates in export (#67), so it's hidden
                  during the print-all pass "Export PDF" triggers. */}
              {!import.meta.env.PROD && !printAll && (
                <div className="chart-wheel-reference">
                  <p className="hint">{t.astrochartReferenceHeading}</p>
                  <div aria-hidden="true">
                    <AstroChartWheel data={load.data} signWedgeStyle={toSignWedgeStyle(extendedSettings)} />
                  </div>
                  <p className="hint">{t.astrochartReferenceHint}</p>
                </div>
              )}

              <div className="chart-export-actions">
                <button type="button" className="quiet" onClick={downloadSvg}>
                  {t.downloadSvg}
                </button>
                <span className="chart-export-png">
                  <select
                    aria-label={t.pngResolutionLabel}
                    value={pngSize}
                    onChange={(event) => {
                      setPngSize(Number(event.target.value));
                    }}
                  >
                    {sizes.map((option) => (
                      <option key={option.size} value={option.size}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="quiet" onClick={downloadPng} disabled={pngBusy}>
                    {pngBusy ? t.rendering : t.downloadPng}
                  </button>
                </span>
                <button type="button" className="quiet" onClick={exportPdf}>
                  {t.exportPdf}
                </button>
              </div>
              {pngError !== undefined && (
                <p className="warning" role="alert">
                  {pngError}
                </p>
              )}
              <p className="hint">{t.exportPdfHint}</p>
            </>
          )}

          {printAll ? (
            <div className="chart-print-all">
              {tabs.map((tab) => (
                <div key={tab}>
                  {renderTableTab(tab, load.data, displayName, pointVisibility, housesRenderable, t, locale)}
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="tabs" role="tablist" aria-label={t.chartDataTablist} onKeyDown={onTabKeyDown}>
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
                    {tabLabels(t)[tab]}
                  </button>
                ))}
              </div>

              <div
                role="tabpanel"
                id={`chart-tabpanel-${activeTab}`}
                aria-labelledby={`chart-tab-${activeTab}`}
                tabIndex={0}
              >
                {renderTableTab(activeTab, load.data, displayName, pointVisibility, housesRenderable, t, locale)}
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
  const t = useMessages(chartViewMessages);
  const [locale] = useLocale();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [settings, setSettings] = useState<ExtendedSettings>(DEFAULT_EXTENDED_SETTINGS);
  // The "Extended settings" panel's house-system/ayanamsa name lookups and the main
  // chart computation below used to hold two separate `WorkerEphemerisProvider`
  // instances — kept apart so that recreating the computation provider on a settings
  // tweak would never dispose the panel's provider out from under it. Both now come
  // from the app-wide shared instance (#315), which is never recreated mid-session, so
  // that concern no longer applies. Reuse is otherwise safe because every call already
  // carries its own zodiac/observer options rather than relying on state a prior call
  // left behind (`#applyZodiac`/`#flagsFor` in `engine.ts` set sidereal mode and the
  // topocentric observer fresh from each request's own options), and the worker
  // serializes requests through one promise chain, so out-of-order settings changes
  // still resolve in order.
  const { provider } = useEphemerisProvider();

  useEffect(() => {
    if (person?.moment === undefined || provider === undefined) return undefined;
    const moment = person.moment;
    // A mutable holder rather than a `let`, matching `App.tsx`'s own effect below.
    const effect = { cancelled: false };
    setLoad({ kind: 'loading' });

    void (async () => {
      try {
        const data = await computeChartData(moment, provider, toChartCalculationOptions(settings));
        if (!effect.cancelled) setLoad({ kind: 'ready', data });
      } catch (error) {
        if (!effect.cancelled)
          setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      effect.cancelled = true;
    };
  }, [personId, momentKey(person?.moment), settings, provider]);

  if (person === undefined) {
    return <PersonNotFound />;
  }

  if (person.moment === undefined) {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
        </p>
        <h1>{t.chartFallback}</h1>
        <p>
          {t.notCompleteChart(person.displayName || t.thisPersonCapitalized)}{' '}
          <a href={`#/person/${personId}`}>{t.personPageLink}</a>.
        </p>
      </main>
    );
  }

  const showHouses = person.timeAccuracy !== 'unknown';

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
      </p>
      <h1>{person.displayName || t.chartFallback}</h1>
      <ShareLink moment={person.moment} housesKnown={showHouses} />
      <ChartDataView
        load={load}
        displayName={person.displayName}
        showHouses={showHouses}
        metaLines={chartSheetMetaLines(person.displayName || t.chartFallback, person.moment, locale)}
        extendedSettings={settings}
        onExtendedSettingsChange={setSettings}
        settingsProvider={provider}
      />
    </main>
  );
}
