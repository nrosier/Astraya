/**
 * Shapes a computed chart into the flat rows its data tables render (#44).
 *
 * Pure and framework-free, like everything under `src/domain`: no React, no
 * ephemeris call, just arithmetic over the `ChartData` `chart-compute.ts`
 * already produced. Kept separate from that module so the (slow, real-engine)
 * integration test for computing a chart and the (fast, pure) test for
 * shaping one into rows can run independently.
 */
import { bodyById, bodyByKey } from '../astrology/bodies.js';
import { houseOf } from '../astrology/emphasis.js';
import { midpointOf } from '../astrology/midpoints.js';
import { degreesInSign, signOf } from '../astrology/signs.js';
import type { ChartData } from './chart-compute.js';
import type { Aspect } from '../astrology/aspects.js';
import type { BodyPosition, Degrees } from '../ephemeris/types.js';
import type { BirthMomentInput } from '../time/types.js';
import type { WheelRingInput } from '../chart/multi-wheel.js';
import type { ChartSheetInput } from '../chart/chart-sheet.js';
import { filterAspectsForDisplay } from '../chart/aspect-web.js';

export interface DegreeParts {
  readonly sign: string;
  readonly degree: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * Splits a longitude into sign name plus degree/minute/second within it.
 *
 * Rounds the whole longitude to the nearest arcsecond *before* finding the
 * sign, rather than after splitting off the within-sign degrees. Rounding
 * after would let something like 29°59'59.6" round its seconds up to a
 * nonexistent 30°00'00" while the sign was already fixed at the *lower*
 * value — a real degree that would then print in the wrong sign. Snapping to
 * the arcsecond first means the sign lookup and the degree split always see
 * the same, already-rounded number.
 */
export function degreeParts(longitude: Degrees): DegreeParts {
  const rounded = Math.round(longitude * 3600) / 3600;
  const sign = signOf(rounded).name;
  const withinSign = degreesInSign(rounded);
  const totalSeconds = Math.round(withinSign * 3600);
  const degree = Math.floor(totalSeconds / 3600);
  const minute = Math.floor((totalSeconds % 3600) / 60);
  const second = totalSeconds % 60;
  return { sign, degree, minute, second };
}

/**
 * Which computed points a chart's tables and wheel actually show. Purely a
 * display filter, never touching `ChartData.positions`/`.aspects` themselves
 * — an aspect to a point hidden here still shows in the Aspects tab by name
 * if it was computed at all (that's `ChartCalculationOptions.aspectsTo`, a
 * compute-layer decision made before this filter ever runs).
 */
export interface PointVisibilityOptions {
  readonly chironVisible?: boolean; // default true
  readonly fortuneVisible?: boolean; // default false
  readonly vertexVisible?: boolean; // default false
  readonly midpointsVisible?: boolean; // default false
}

/** Drops Chiron from a position list when `chironVisible` is false. */
export function visiblePositions(
  positions: readonly BodyPosition[],
  options: PointVisibilityOptions = {},
): readonly BodyPosition[] {
  if (options.chironVisible ?? true) return positions;
  return positions.filter((position) => bodyById(position.body)?.category !== 'centaur');
}

export interface PositionRow extends DegreeParts {
  readonly bodyKey: string;
  readonly bodyName: string;
  readonly longitude: Degrees;
  readonly speed: number;
  readonly retrograde: boolean;
  readonly house: number;
}

/** One row per visible body, in `ChartData.positions`' own order. */
export function positionRows(data: ChartData, options: PointVisibilityOptions = {}): readonly PositionRow[] {
  return visiblePositions(data.positions, options).map((position) => {
    const body = bodyById(position.body);
    return {
      bodyKey: body?.key ?? String(position.body),
      bodyName: body?.name ?? String(position.body),
      longitude: position.longitude,
      speed: position.longitudeSpeed,
      retrograde: position.retrograde,
      house: houseOf(position.longitude, data.houses.cusps),
      ...degreeParts(position.longitude),
    };
  });
}

export interface HouseCuspRow extends DegreeParts {
  readonly house: number;
  readonly longitude: Degrees;
}

/** One row per house cusp (skipping the unused index 0). */
export function houseCuspRows(data: ChartData): readonly HouseCuspRow[] {
  const { cusps } = data.houses;
  const rows: HouseCuspRow[] = [];
  for (let house = 1; house < cusps.length; house++) {
    const longitude = cusps[house];
    if (longitude === undefined) continue;
    rows.push({ house, longitude, ...degreeParts(longitude) });
  }
  return rows;
}

export interface AngleRow extends DegreeParts {
  readonly label: string;
  readonly longitude: Degrees;
}

/** The angles `HousePositions` carries alongside the cusps themselves; the Vertex is dropped unless `vertexVisible` is true. */
export function angleRows(data: ChartData, options: PointVisibilityOptions = {}): readonly AngleRow[] {
  const angles: readonly (readonly [string, Degrees])[] = [
    ['Ascendant', data.houses.ascendant],
    ['Midheaven', data.houses.midheaven],
    ['ARMC', data.houses.armc],
    ...(options.vertexVisible === true ? [['Vertex', data.houses.vertex] as const] : []),
    ['Equatorial Ascendant', data.houses.equatorialAscendant],
    ['Co-Ascendant (Koch)', data.houses.coAscendantKoch],
    ['Co-Ascendant (Munkasey)', data.houses.coAscendantMunkasey],
    ['Polar Ascendant', data.houses.polarAscendant],
  ];
  return angles.map(([label, longitude]) => ({ label, longitude, ...degreeParts(longitude) }));
}

export interface AspectRow {
  readonly bodyAKey: string;
  readonly bodyAName: string;
  readonly bodyBKey: string;
  readonly bodyBName: string;
  readonly aspect: string;
  readonly angle: Degrees;
  readonly separation: Degrees;
  readonly orb: Degrees;
  readonly applying: boolean;
}

function aspectRow(aspect: Aspect): AspectRow {
  const bodyA = bodyById(aspect.bodyA);
  const bodyB = bodyById(aspect.bodyB);
  return {
    bodyAKey: bodyA?.key ?? String(aspect.bodyA),
    bodyAName: bodyA?.name ?? String(aspect.bodyA),
    bodyBKey: bodyB?.key ?? String(aspect.bodyB),
    bodyBName: bodyB?.name ?? String(aspect.bodyB),
    aspect: aspect.aspect.name,
    angle: aspect.aspect.angle,
    separation: aspect.separation,
    orb: aspect.orb,
    applying: aspect.applying,
  };
}

/** One row per aspect found, in `ChartData.aspects`' own order. */
export function aspectRows(data: ChartData): readonly AspectRow[] {
  return data.aspects.map(aspectRow);
}

export interface DignityRow {
  readonly bodyKey: string;
  readonly bodyName: string;
  readonly ruler: boolean;
  readonly exalted: boolean;
  readonly detriment: boolean;
  readonly fall: boolean;
}

/** One row per visible body, in `ChartData.positions`' own order — every body, not only ones holding a dignity. */
export function dignityRows(data: ChartData, options: PointVisibilityOptions = {}): readonly DignityRow[] {
  return visiblePositions(data.positions, options).map((position) => {
    const body = bodyById(position.body);
    const dignities = data.dignities.get(position.body);
    return {
      bodyKey: body?.key ?? String(position.body),
      bodyName: body?.name ?? String(position.body),
      ruler: dignities?.ruler ?? false,
      exalted: dignities?.exalted ?? false,
      detriment: dignities?.detriment ?? false,
      fall: dignities?.fall ?? false,
    };
  });
}

export interface DerivedPointRow extends DegreeParts {
  readonly label: string;
  readonly longitude: Degrees;
}

/**
 * Part of Fortune (dropped unless `fortuneVisible` is true), Part of Spirit
 * (sect-corrected in `computeChartData` already), and — when `midpointsVisible`
 * is true — the ASC/MC and Sun/Moon midpoints Astro-Seek shows by default.
 */
export function derivedPointRows(data: ChartData, options: PointVisibilityOptions = {}): readonly DerivedPointRow[] {
  const midpointRows: DerivedPointRow[] = [];
  if (options.midpointsVisible === true) {
    const ascMc = midpointOf(data.houses.ascendant, data.houses.midheaven);
    midpointRows.push({ label: 'ASC/MC Midpoint', longitude: ascMc, ...degreeParts(ascMc) });

    const sunBody = bodyByKey('sun');
    const moonBody = bodyByKey('moon');
    const sunPosition = sunBody && data.positions.find((position) => position.body === sunBody.id);
    const moonPosition = moonBody && data.positions.find((position) => position.body === moonBody.id);
    if (sunPosition && moonPosition) {
      const sunMoon = midpointOf(sunPosition.longitude, moonPosition.longitude);
      midpointRows.push({ label: 'Sun/Moon Midpoint', longitude: sunMoon, ...degreeParts(sunMoon) });
    }
  }

  return [
    ...(options.fortuneVisible === true
      ? [{ label: 'Part of Fortune', longitude: data.partOfFortune, ...degreeParts(data.partOfFortune) }]
      : []),
    { label: 'Part of Spirit', longitude: data.partOfSpirit, ...degreeParts(data.partOfSpirit) },
    ...midpointRows,
  ];
}

/**
 * Shapes a computed chart as the single ring `renderMultiWheelSvg` (#52) needs to draw it.
 *
 * The wheel's aspect web is limited to the five major (Ptolemaic) aspects — conjunction,
 * sextile, square, trine, opposition — the same default nearly every astrology tool ships
 * with. Astraya computes six minor aspects too (semisextile, semisquare, quintile,
 * sesquiquadrate, biquintile, quincunx), but drawing all eleven as chords turns the wheel
 * into a knot; the Aspects tab and the sheet's aspect matrix still show every aspect Astraya
 * finds, minor ones included, so nothing is actually hidden — only the wheel's chords are.
 */
export function chartWheelRing(data: ChartData, label = 'Natal', options: PointVisibilityOptions = {}): WheelRingInput {
  return {
    label,
    houses: data.houses,
    bodies: visiblePositions(data.positions, options).map((position) => ({
      body: position.body,
      key: bodyById(position.body)?.key ?? String(position.body),
      longitude: position.longitude,
    })),
    aspects: filterAspectsForDisplay(data.aspects, { visibleFamilies: ['major'] }),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The header lines a chart sheet is titled with: who, when, where.
 *
 * The civil date and time are printed exactly as the user entered them, with no
 * zone conversion — a chart's header states the birth record, and a reader
 * checking the sheet against a birth certificate needs the figures on the
 * certificate, not the UTC instant derived from them. Coordinates are given in
 * decimal degrees with a hemisphere letter, which is unambiguous at any
 * precision (unlike a signed number, whose sign convention differs by source).
 */
export function chartSheetMetaLines(displayName: string, moment: BirthMomentInput): readonly string[] {
  const { civil, coordinates } = moment;
  const date = `${String(civil.year)}-${pad2(civil.month)}-${pad2(civil.day)}`;
  const time = `${pad2(civil.hour)}:${pad2(civil.minute)}`;
  const latitude = `${Math.abs(coordinates.latitude).toFixed(2)}°${coordinates.latitude < 0 ? 'S' : 'N'}`;
  const longitude = `${Math.abs(coordinates.longitude).toFixed(2)}°${coordinates.longitude < 0 ? 'W' : 'E'}`;
  const zone = moment.zoneOverride ?? (moment.offsetOverrideMinutes === undefined ? undefined : 'stated offset');
  return [
    displayName || 'Chart',
    zone === undefined ? `${date} ${time}` : `${date} ${time} (${zone})`,
    `${latitude} ${longitude}`,
  ];
}

/**
 * Shapes a computed chart as the whole sheet `renderChartSheetSvg` draws.
 *
 * All three data panels take their bodies from `data.positions` in its own
 * order, so a chart computed with the asteroids switched on grows every panel
 * together, and the aspect grid's rows line up with the Positions table above
 * it. Aspects are passed through rather than re-derived, which is what keeps
 * the grid from ever disagreeing with the Aspects table on the same screen.
 */
export function chartSheetInput(
  data: ChartData,
  metaLines: readonly string[] = [],
  label = 'Natal',
  options: PointVisibilityOptions = {},
): ChartSheetInput {
  const bodies = visiblePositions(data.positions, options).map((position) => {
    const body = bodyById(position.body);
    return {
      body: position.body,
      key: body?.key ?? String(position.body),
      label: body?.name ?? String(position.body),
      longitude: position.longitude,
    };
  });
  return {
    metaLines,
    rings: [chartWheelRing(data, label, options)],
    matrix: {
      bodies: bodies.map(({ key, label: bodyLabel }) => ({ key, label: bodyLabel })),
      aspects: data.aspects.map((aspect) => ({
        aKey: bodyById(aspect.bodyA)?.key ?? String(aspect.bodyA),
        bKey: bodyById(aspect.bodyB)?.key ?? String(aspect.bodyB),
        aspectKey: aspect.aspect.key,
        orb: aspect.orb,
        applying: aspect.applying,
      })),
    },
    emphasis: { bodies: bodies.map(({ body, key, longitude }) => ({ body, key, longitude })) },
    strip: { bodies: bodies.map(({ key, longitude }) => ({ key, longitude })) },
  };
}
