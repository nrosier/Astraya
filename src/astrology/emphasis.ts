/**
 * Element, modality, quadrant and hemisphere weighting (#36).
 *
 * All of this is the same shape of question — "how much weight falls into
 * each bucket?" — asked against a different partition of the chart: the
 * four elements or three modalities a body's sign carries, or the quadrant
 * and hemisphere its longitude falls into relative to the angles.
 *
 * Quadrants are bounded by the four angles (Ascendant, IC, Descendant, MC),
 * not by house cusps — they are the same regardless of house system, which
 * is why `quadrantOf` only needs the ascendant and midheaven, not a full
 * `HousePositions`. House cusps are needed only for `houseOf`/`dominantHouse`,
 * where the actual house system matters.
 *
 * Every tally accepts an optional body-weight map (weight 1 when a body is
 * unlisted), satisfying "configurable body weights" uniformly rather than as
 * a separate mechanism.
 */
import type { BodyId, Degrees } from '../ephemeris/types.js';
import { type RulershipScheme, rulerOf } from './dignities.js';
import { type Element, type Modality, SIGNS, signIndex, signOf } from './signs.js';

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

function weightOf(body: BodyId, weights: ReadonlyMap<BodyId, number> | undefined): number {
  return weights?.get(body) ?? 1;
}

/** Sum of body weights, grouped however `keyOf` classifies each body's longitude. */
function tally<K>(
  positions: ReadonlyMap<BodyId, Degrees>,
  weights: ReadonlyMap<BodyId, number> | undefined,
  keyOf: (longitude: Degrees) => K,
): Map<K, number> {
  const result = new Map<K, number>();
  for (const [body, longitude] of positions) {
    const key = keyOf(longitude);
    result.set(key, (result.get(key) ?? 0) + weightOf(body, weights));
  }
  return result;
}

/** Every key in `order`, defaulting to 0 — so callers never have to handle a missing bucket. */
function fullBalance<K extends string>(
  counts: ReadonlyMap<K, number>,
  order: readonly K[],
): Readonly<Record<K, number>> {
  const result = {} as Record<K, number>;
  for (const key of order) result[key] = counts.get(key) ?? 0;
  return result;
}

/** The key with the highest tally, ties broken by earliest position in `order`. `undefined` if every tally is 0. */
function dominantKey<K>(counts: ReadonlyMap<K, number>, order: readonly K[]): K | undefined {
  let best: K | undefined;
  let bestCount = 0;
  for (const key of order) {
    const count = counts.get(key) ?? 0;
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

const ELEMENTS: readonly Element[] = ['fire', 'earth', 'air', 'water'];
const MODALITIES: readonly Modality[] = ['cardinal', 'fixed', 'mutable'];
const SIGN_INDICES: readonly number[] = SIGNS.map((sign) => sign.index);

export type ElementBalance = Readonly<Record<Element, number>>;
export type ModalityBalance = Readonly<Record<Modality, number>>;

export function elementBalance(
  positions: ReadonlyMap<BodyId, Degrees>,
  weights?: ReadonlyMap<BodyId, number>,
): ElementBalance {
  return fullBalance(
    tally(positions, weights, (longitude) => signOf(longitude).element),
    ELEMENTS,
  );
}

export function modalityBalance(
  positions: ReadonlyMap<BodyId, Degrees>,
  weights?: ReadonlyMap<BodyId, number>,
): ModalityBalance {
  return fullBalance(
    tally(positions, weights, (longitude) => signOf(longitude).modality),
    MODALITIES,
  );
}

/** The sign holding the most (weighted) bodies. `undefined` for an empty chart. */
export function dominantSign(
  positions: ReadonlyMap<BodyId, Degrees>,
  weights?: ReadonlyMap<BodyId, number>,
): number | undefined {
  return dominantKey(tally(positions, weights, signIndex), SIGN_INDICES);
}

/**
 * The traditional ruler of the dominant sign. A deliberately simple reading
 * of "dominant planet" — a full dominance score weighing aspects, dignity
 * and angularity together is a distinct, much larger feature and not what
 * this issue's checklist asks for.
 */
export function dominantPlanet(
  positions: ReadonlyMap<BodyId, Degrees>,
  weights?: ReadonlyMap<BodyId, number>,
  scheme: RulershipScheme = 'traditional',
): BodyId | undefined {
  const sign = dominantSign(positions, weights);
  return sign === undefined ? undefined : rulerOf(sign, scheme);
}

/** Which house (1-based) a longitude falls in, given cusps in the `HousePositions.cusps` layout (index 0 unused). */
export function houseOf(longitude: Degrees, cusps: readonly Degrees[]): number {
  const houseCount = cusps.length - 1;
  for (let house = 1; house <= houseCount; house++) {
    const start = cusps[house];
    const end = cusps[house === houseCount ? 1 : house + 1];
    if (start === undefined || end === undefined) continue;
    if (norm360(longitude - start) < norm360(end - start)) return house;
  }
  throw new RangeError(`longitude ${longitude} did not match any house among ${houseCount} cusps`);
}

/** The house holding the most (weighted) bodies. `undefined` for an empty chart. */
export function dominantHouse(
  positions: ReadonlyMap<BodyId, Degrees>,
  cusps: readonly Degrees[],
  weights?: ReadonlyMap<BodyId, number>,
): number | undefined {
  const houseCount = cusps.length - 1;
  const order = Array.from({ length: houseCount }, (_, i) => i + 1);
  return dominantKey(
    tally(positions, weights, (longitude) => houseOf(longitude, cusps)),
    order,
  );
}

export type Quadrant = 1 | 2 | 3 | 4;

/**
 * Which quarter of the chart a longitude falls in: Q1 = Ascendant to IC, Q2 =
 * IC to Descendant, Q3 = Descendant to MC, Q4 = MC to Ascendant — the order
 * house cusps increase in. Only the ascendant and midheaven are needed: the
 * Descendant and IC are always exactly opposite them.
 */
export function quadrantOf(longitude: Degrees, ascendant: Degrees, midheaven: Degrees): Quadrant {
  const offset = norm360(longitude - ascendant);
  const mcOffset = norm360(midheaven - ascendant);
  const icOffset = norm360(mcOffset + 180);
  if (offset < icOffset) return 1;
  if (offset < 180) return 2;
  if (offset < mcOffset) return 3;
  return 4;
}

export type EastWest = 'eastern' | 'western';
export type NorthSouth = 'northern' | 'southern';

/** Eastern = around the Ascendant (Q1, Q4); western = around the Descendant (Q2, Q3). */
export function eastWestOf(quadrant: Quadrant): EastWest {
  return quadrant === 1 || quadrant === 4 ? 'eastern' : 'western';
}

/** Northern = below the horizon (Q1, Q2); southern = above it (Q3, Q4). */
export function northSouthOf(quadrant: Quadrant): NorthSouth {
  return quadrant === 1 || quadrant === 2 ? 'northern' : 'southern';
}

export interface QuadrantEmphasis {
  readonly q1: number;
  readonly q2: number;
  readonly q3: number;
  readonly q4: number;
}

export function quadrantEmphasis(
  positions: ReadonlyMap<BodyId, Degrees>,
  ascendant: Degrees,
  midheaven: Degrees,
  weights?: ReadonlyMap<BodyId, number>,
): QuadrantEmphasis {
  const counts = tally(positions, weights, (longitude) => quadrantOf(longitude, ascendant, midheaven));
  return { q1: counts.get(1) ?? 0, q2: counts.get(2) ?? 0, q3: counts.get(3) ?? 0, q4: counts.get(4) ?? 0 };
}

export interface HemisphereEmphasis {
  readonly eastern: number;
  readonly western: number;
  readonly northern: number;
  readonly southern: number;
}

/** Derived from a `QuadrantEmphasis` rather than re-tallying the chart. */
export function hemisphereEmphasis(quadrants: QuadrantEmphasis): HemisphereEmphasis {
  return {
    eastern: quadrants.q1 + quadrants.q4,
    western: quadrants.q2 + quadrants.q3,
    northern: quadrants.q1 + quadrants.q2,
    southern: quadrants.q3 + quadrants.q4,
  };
}
