/**
 * Shapes a computed chart into the flat rows its data tables render (#44).
 *
 * Pure and framework-free, like everything under `src/domain`: no React, no
 * ephemeris call, just arithmetic over the `ChartData` `chart-compute.ts`
 * already produced. Kept separate from that module so the (slow, real-engine)
 * integration test for computing a chart and the (fast, pure) test for
 * shaping one into rows can run independently.
 */
import { bodyById } from '../astrology/bodies.js';
import { houseOf } from '../astrology/emphasis.js';
import { degreesInSign, signOf } from '../astrology/signs.js';
import type { ChartData } from './chart-compute.js';
import type { Aspect } from '../astrology/aspects.js';
import type { Degrees } from '../ephemeris/types.js';
import type { WheelRingInput } from '../chart/multi-wheel.js';

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

export interface PositionRow extends DegreeParts {
  readonly bodyKey: string;
  readonly bodyName: string;
  readonly longitude: Degrees;
  readonly speed: number;
  readonly retrograde: boolean;
  readonly house: number;
}

/** One row per body the ephemeris returned a position for, in `ChartData.positions`' own order. */
export function positionRows(data: ChartData): readonly PositionRow[] {
  return data.positions.map((position) => {
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

/** The angles `HousePositions` carries alongside the cusps themselves. */
export function angleRows(data: ChartData): readonly AngleRow[] {
  const angles: readonly (readonly [string, Degrees])[] = [
    ['Ascendant', data.houses.ascendant],
    ['Midheaven', data.houses.midheaven],
    ['ARMC', data.houses.armc],
    ['Vertex', data.houses.vertex],
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

/** One row per body, in `ChartData.positions`' own order — every body, not only ones holding a dignity. */
export function dignityRows(data: ChartData): readonly DignityRow[] {
  return data.positions.map((position) => {
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

/** Part of Fortune and Part of Spirit, sect-corrected in `computeChartData` already. */
export function derivedPointRows(data: ChartData): readonly DerivedPointRow[] {
  return [
    { label: 'Part of Fortune', longitude: data.partOfFortune, ...degreeParts(data.partOfFortune) },
    { label: 'Part of Spirit', longitude: data.partOfSpirit, ...degreeParts(data.partOfSpirit) },
  ];
}

/** Shapes a computed chart as the single ring `renderMultiWheelSvg` (#52) needs to draw it. */
export function chartWheelRing(data: ChartData, label = 'Natal'): WheelRingInput {
  return {
    label,
    houses: data.houses,
    bodies: data.positions.map((position) => ({
      body: position.body,
      key: bodyById(position.body)?.key ?? String(position.body),
      longitude: position.longitude,
    })),
    aspects: data.aspects,
  };
}
