/**
 * Rule engine with salience ranking (#60): scores every placement a computed
 * chart actually has against weighted rules over planet, sign, house,
 * dignity, sect, angularity and retrograde, then ranks them so a report
 * (#61) can pick the handful of placements most worth saying instead of
 * dumping every placement a chart has in birth order.
 *
 * Deliberately downstream of #36's `emphasis.ts`, not a re-implementation of
 * it: `emphasis.ts`'s own doc comment for `dominantPlanet` explicitly
 * disclaims being "a full dominance score weighing aspects, dignity and
 * angularity together" — this module is exactly that disclaimed feature,
 * scored per placement rather than tallied across the whole chart. It stays
 * a plain function of `ChartData`, so identical input always produces
 * identical, identically-ordered output.
 *
 * The `nakshatra` and `pattern` corpus categories (`schema.ts`) are out of
 * scope here: neither is named in #60's checklist, and both need input
 * `ChartData` doesn't carry — nakshatra needs a sidereal longitude, and
 * pattern needs a whole-chart shape classifier (#35's `jonesShapeOf`) whose
 * salience is a whole-chart question, not a single placement's.
 */
import { angularSeparation, DEFAULT_ORB_CONFIG, orbFor, type AspectFamily } from '../astrology/aspects.js';
import { bodyById, type BodyCategory } from '../astrology/bodies.js';
import { houseOf } from '../astrology/emphasis.js';
import type { Sect } from '../astrology/sect.js';
import { signIndex } from '../astrology/signs.js';
import type { Degrees, HousePositions } from '../ephemeris/types.js';
import type { ChartData } from '../domain/chart-compute.js';
import { dignityState, placementKey, type CorpusPlacement, type DignityState } from './schema.js';

export interface SalienceFactor {
  /** Which rule contributed this weight — the label #62's provenance view shows. */
  readonly rule: string;
  readonly weight: number;
  /** Human-readable reason, e.g. `"ruler"` or `"3.2° from an angle"`. */
  readonly detail: string;
}

export interface SalientPlacement {
  readonly placement: CorpusPlacement;
  /** `placementKey(placement)` — the corpus lookup key, computed once here rather than re-derived by every caller. */
  readonly key: string;
  /** Sum of every contributing factor's weight. Has no fixed ceiling; only relative order matters. */
  readonly salience: number;
  readonly factors: readonly SalienceFactor[];
}

/** How much narrative weight a body's placement carries by default, before any situational bonus. */
const BODY_CATEGORY_WEIGHT: Readonly<Record<BodyCategory, number>> = {
  luminary: 1,
  planet: 0.8,
  node: 0.5,
  centaur: 0.4,
  lilith: 0.3,
  asteroid: 0.2,
};

const DIGNITY_WEIGHT: Readonly<Record<DignityState, number>> = {
  ruler: 0.6,
  exalted: 0.5,
  detriment: 0.35,
  fall: 0.3,
};

/** Only classical planets turning retrograde is an interpretively notable deviation. */
const RETROGRADE_WEIGHT = 0.3;
const RETROGRADE_ELIGIBLE_CATEGORY: BodyCategory = 'planet';

const SECT_LIGHT_WEIGHT = 0.4;

/**
 * Degrees within which a body counts as meaningfully "angular" — the same
 * order as a major aspect's orb, not a claim of universal agreement on where
 * an angle's influence actually ends.
 */
const ANGULARITY_ORB: Degrees = 8;

const ASPECT_FAMILY_WEIGHT: Readonly<Record<AspectFamily, number>> = { major: 0.5, minor: 0.2 };

type HouseClass = 'angular' | 'succedent' | 'cadent';
const HOUSE_CLASS_WEIGHT: Readonly<Record<HouseClass, number>> = { angular: 1, succedent: 0.6, cadent: 0.3 };
const ANGULAR_HOUSES = new Set([1, 4, 7, 10]);
const SUCCEDENT_HOUSES = new Set([2, 5, 8, 11]);

function houseClassOf(house: number): HouseClass {
  if (ANGULAR_HOUSES.has(house)) return 'angular';
  if (SUCCEDENT_HOUSES.has(house)) return 'succedent';
  return 'cadent';
}

/** The number of "how far worth talking about" placements a report (#61) actually wants. */
export const DEFAULT_SALIENCE_LIMIT = 24;

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/**
 * The minimum angular separation from `longitude` to any of the chart's four
 * angles (Ascendant, Midheaven, Descendant, IC). The Descendant and IC are
 * always exactly opposite the Ascendant and Midheaven, so only those two are
 * needed from `houses`.
 */
export function angularityOf(longitude: Degrees, houses: HousePositions): Degrees {
  const descendant = norm360(houses.ascendant + 180);
  const imumCoeli = norm360(houses.midheaven + 180);
  return Math.min(
    angularSeparation(longitude, houses.ascendant),
    angularSeparation(longitude, houses.midheaven),
    angularSeparation(longitude, descendant),
    angularSeparation(longitude, imumCoeli),
  );
}

function place(placement: CorpusPlacement, factors: readonly SalienceFactor[]): SalientPlacement {
  return {
    placement,
    key: placementKey(placement),
    salience: factors.reduce((total, factor) => total + factor.weight, 0),
    factors,
  };
}

function bodyCategoryFactor(category: BodyCategory): SalienceFactor {
  return { rule: 'body-category', weight: BODY_CATEGORY_WEIGHT[category], detail: category };
}

function dignityFactor(state: DignityState | undefined): SalienceFactor | undefined {
  return state === undefined ? undefined : { rule: 'dignity', weight: DIGNITY_WEIGHT[state], detail: state };
}

function sectLightFactor(bodyKey: string, sect: Sect): SalienceFactor | undefined {
  const isLight = (bodyKey === 'sun' && sect === 'day') || (bodyKey === 'moon' && sect === 'night');
  return isLight ? { rule: 'sect-light', weight: SECT_LIGHT_WEIGHT, detail: `${sect} chart's sect light` } : undefined;
}

function retrogradeFactor(category: BodyCategory, retrograde: boolean): SalienceFactor | undefined {
  // The Moon and Sun never retrograde geocentrically, and the nodes/Lilith
  // variants regress by definition — none of that is a notable deviation the
  // way a classical planet turning retrograde is, so only `planet` qualifies.
  return category === RETROGRADE_ELIGIBLE_CATEGORY && retrograde
    ? { rule: 'retrograde', weight: RETROGRADE_WEIGHT, detail: 'retrograde' }
    : undefined;
}

function angularityFactor(longitude: Degrees, houses: HousePositions): SalienceFactor | undefined {
  const distance = angularityOf(longitude, houses);
  if (distance >= ANGULARITY_ORB) return undefined;
  const weight = 1 - distance / ANGULARITY_ORB;
  return { rule: 'angularity', weight, detail: `${distance.toFixed(1)}° from an angle` };
}

/**
 * `undefined` outside a traditional 12-house system: angular/succedent/cadent
 * is a 12-house classification and doesn't map onto e.g. Gauquelin's 36
 * sectors, so it is omitted there rather than misapplied to a house number
 * that means something different.
 */
function houseClassFactor(house: number, houseCount: number): SalienceFactor | undefined {
  if (houseCount !== 12) return undefined;
  const cls = houseClassOf(house);
  return { rule: 'house', weight: HOUSE_CLASS_WEIGHT[cls], detail: `house ${String(house)} (${cls})` };
}

function planetInSignPlacements(chart: ChartData): SalientPlacement[] {
  const placements: SalientPlacement[] = [];
  for (const position of chart.positions) {
    const body = bodyById(position.body);
    if (body === undefined) continue;
    const factors: SalienceFactor[] = [bodyCategoryFactor(body.category)];
    const dignities = chart.dignities.get(position.body);
    const dignity = dignityFactor(dignities === undefined ? undefined : dignityState(dignities));
    if (dignity) factors.push(dignity);
    const sectLight = sectLightFactor(body.key, chart.sect);
    if (sectLight) factors.push(sectLight);
    const retro = retrogradeFactor(body.category, position.retrograde);
    if (retro) factors.push(retro);
    placements.push(
      place({ category: 'planet-in-sign', body: body.key, sign: signIndex(position.longitude) }, factors),
    );
  }
  return placements;
}

function planetInHousePlacements(chart: ChartData): SalientPlacement[] {
  const houseCount = chart.houses.cusps.length - 1;
  const placements: SalientPlacement[] = [];
  for (const position of chart.positions) {
    const body = bodyById(position.body);
    if (body === undefined) continue;
    const house = houseOf(position.longitude, chart.houses.cusps);
    const factors: SalienceFactor[] = [bodyCategoryFactor(body.category)];
    const houseClass = houseClassFactor(house, houseCount);
    if (houseClass) factors.push(houseClass);
    const angularity = angularityFactor(position.longitude, chart.houses);
    if (angularity) factors.push(angularity);
    const retro = retrogradeFactor(body.category, position.retrograde);
    if (retro) factors.push(retro);
    placements.push(place({ category: 'planet-in-house', body: body.key, house }, factors));
  }
  return placements;
}

function signOnCuspPlacements(chart: ChartData): SalientPlacement[] {
  const houseCount = chart.houses.cusps.length - 1;
  const placements: SalientPlacement[] = [];
  for (let house = 1; house <= houseCount; house++) {
    const cusp = chart.houses.cusps[house];
    if (cusp === undefined) continue;
    const factors: SalienceFactor[] = [];
    const houseClass = houseClassFactor(house, houseCount);
    if (houseClass) factors.push(houseClass);
    const angularity = angularityFactor(cusp, chart.houses);
    if (angularity) factors.push(angularity);
    placements.push(place({ category: 'sign-on-cusp', sign: signIndex(cusp), house }, factors));
  }
  return placements;
}

function aspectPairPlacements(chart: ChartData): SalientPlacement[] {
  const placements: SalientPlacement[] = [];
  for (const aspect of chart.aspects) {
    const bodyA = bodyById(aspect.bodyA);
    const bodyB = bodyById(aspect.bodyB);
    if (bodyA === undefined || bodyB === undefined) continue;
    const allowedOrb = orbFor(aspect.aspect.key, bodyA.category, bodyB.category, DEFAULT_ORB_CONFIG);
    const tightness = allowedOrb <= 0 ? 1 : Math.max(0, 1 - aspect.orb / allowedOrb);
    const factors: SalienceFactor[] = [
      {
        rule: 'body-category',
        weight: (BODY_CATEGORY_WEIGHT[bodyA.category] + BODY_CATEGORY_WEIGHT[bodyB.category]) / 2,
        detail: `${bodyA.category}-${bodyB.category}`,
      },
      { rule: 'aspect-family', weight: ASPECT_FAMILY_WEIGHT[aspect.aspect.family], detail: aspect.aspect.family },
      { rule: 'aspect-orb', weight: tightness, detail: `${aspect.orb.toFixed(2)}° orb` },
    ];
    const [pairA, pairB] = bodyA.key <= bodyB.key ? [bodyA.key, bodyB.key] : [bodyB.key, bodyA.key];
    placements.push(place({ category: 'aspect-pair', aspect: aspect.aspect.key, bodyA: pairA, bodyB: pairB }, factors));
  }
  return placements;
}

function dignityStatePlacements(chart: ChartData): SalientPlacement[] {
  const placements: SalientPlacement[] = [];
  for (const [bodyId, dignities] of chart.dignities) {
    const state = dignityState(dignities);
    if (state === undefined) continue;
    const body = bodyById(bodyId);
    if (body === undefined) continue;
    const factors: SalienceFactor[] = [bodyCategoryFactor(body.category)];
    const dignity = dignityFactor(state);
    if (dignity) factors.push(dignity);
    placements.push(place({ category: 'dignity-state', body: body.key, state }, factors));
  }
  return placements;
}

/**
 * Every placement (#53's `CorpusPlacement` categories this module covers)
 * a computed chart actually has, each with its own salience score and the
 * factors that produced it. Unordered — call `rankPlacements` or
 * `selectSalientPlacements` to get a report-ready order.
 */
export function derivePlacements(chart: ChartData): readonly SalientPlacement[] {
  return [
    ...planetInSignPlacements(chart),
    ...planetInHousePlacements(chart),
    ...signOnCuspPlacements(chart),
    ...aspectPairPlacements(chart),
    ...dignityStatePlacements(chart),
  ];
}

/** Most salient first; ties broken by placement key so identical input always sorts identically. */
export function rankPlacements(placements: readonly SalientPlacement[]): readonly SalientPlacement[] {
  return [...placements].sort((left, right) => right.salience - left.salience || left.key.localeCompare(right.key));
}

/**
 * Ranks every placement a chart has and keeps only the most salient `limit`
 * — the handful of things a report (#61) is actually built to say, not a
 * dump of every placement a chart happens to have.
 */
export function selectSalientPlacements(
  chart: ChartData,
  limit: number = DEFAULT_SALIENCE_LIMIT,
): readonly SalientPlacement[] {
  return rankPlacements(derivePlacements(chart)).slice(0, limit);
}
