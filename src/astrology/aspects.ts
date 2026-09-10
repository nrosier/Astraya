/**
 * The Ptolemaic and minor aspects between two bodies, with configurable orbs
 * and applying/separating direction (#24).
 *
 * Purely arithmetic over longitudes and longitude speeds already returned by
 * the ephemeris — no dependency on the engine itself, matching the rest of
 * `src/astrology/**`.
 *
 * The "quintile series" is the family built on a fifth of the circle (72°):
 * quintile and biquintile. The decile (36°, a tenth of the circle) is
 * sometimes lumped in with it by name but is a different division, so it is
 * out of scope here rather than silently folded in.
 */
import type { BodyCategory } from './bodies.js';
import type { BodyId, BodyPosition, Degrees } from '../ephemeris/types.js';

export type AspectFamily = 'major' | 'minor';

export interface AspectDefinition {
  readonly key: string;
  readonly name: string;
  /** The exact angular separation this aspect names, in [0, 180]. */
  readonly angle: Degrees;
  readonly family: AspectFamily;
}

export const ASPECTS: readonly AspectDefinition[] = [
  { key: 'conjunction', name: 'Conjunction', angle: 0, family: 'major' },
  { key: 'semisextile', name: 'Semisextile', angle: 30, family: 'minor' },
  { key: 'semisquare', name: 'Semisquare', angle: 45, family: 'minor' },
  { key: 'sextile', name: 'Sextile', angle: 60, family: 'major' },
  { key: 'quintile', name: 'Quintile', angle: 72, family: 'minor' },
  { key: 'square', name: 'Square', angle: 90, family: 'major' },
  { key: 'trine', name: 'Trine', angle: 120, family: 'major' },
  { key: 'sesquiquadrate', name: 'Sesquiquadrate', angle: 135, family: 'minor' },
  { key: 'biquintile', name: 'Biquintile', angle: 144, family: 'minor' },
  { key: 'quincunx', name: 'Quincunx', angle: 150, family: 'minor' },
  { key: 'opposition', name: 'Opposition', angle: 180, family: 'major' },
];

const BY_KEY = new Map<string, AspectDefinition>(ASPECTS.map((aspect) => [aspect.key, aspect]));

export function aspectByKey(key: string): AspectDefinition | undefined {
  return BY_KEY.get(key);
}

/**
 * Orb configuration: three tiers (the four non-sextile major aspects,
 * sextile on its own, and the six minors as a single flat tier), each widened
 * when either body in the pair is a luminary (Sun or Moon) — the traditional
 * allowance for how much more an aspect involving a luminary is felt to
 * "reach" — followed by a global percentage scale applied to every tier at
 * once.
 *
 * These three tiers and their numbers are the ones most astrology sites,
 * including Astro-Seek, use as their own defaults: major aspects at 7°,
 * enlarged to 10° with a luminary; sextile at 4°, enlarged to 5°30'; every
 * minor aspect at a flat 2°30' regardless of which bodies are involved.
 * `enabledMinorAspects` is which of the six minor aspects `matchAspect`
 * considers at all — empty by default, since minor aspects are opt-in on
 * most tools rather than shown alongside the majors unconditionally.
 */
export interface OrbRule {
  readonly base: Degrees;
  readonly luminaryBonus: Degrees;
}

export interface OrbConfig {
  readonly majorOrb: OrbRule;
  readonly sextileOrb: OrbRule;
  readonly minorOrb: Degrees;
  /** Percentage adjustment applied to every orb above, e.g. -90..90. */
  readonly scalePercent: number;
  /** Which minor-family aspect keys `matchAspect` considers; empty means none. */
  readonly enabledMinorAspects: readonly string[];
}

export const DEFAULT_ORB_CONFIG: OrbConfig = {
  majorOrb: { base: 7, luminaryBonus: 3 },
  sextileOrb: { base: 4, luminaryBonus: 1.5 },
  minorOrb: 2.5,
  scalePercent: 0,
  enabledMinorAspects: [],
};

export function orbFor(
  aspectKey: string,
  categoryA: BodyCategory,
  categoryB: BodyCategory,
  config: OrbConfig = DEFAULT_ORB_CONFIG,
): Degrees {
  const aspect = aspectByKey(aspectKey);
  if (aspect === undefined) {
    throw new RangeError(`no orb configured for aspect "${aspectKey}"`);
  }
  const hasLuminary = categoryA === 'luminary' || categoryB === 'luminary';
  const raw =
    aspectKey === 'sextile'
      ? hasLuminary
        ? config.sextileOrb.base + config.sextileOrb.luminaryBonus
        : config.sextileOrb.base
      : aspect.family === 'major'
        ? hasLuminary
          ? config.majorOrb.base + config.majorOrb.luminaryBonus
          : config.majorOrb.base
        : config.minorOrb;
  return raw * (1 + config.scalePercent / 100);
}

/** Normalise to the half-open interval [0, 360). */
function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** The shortest-path angle from `a` to `b`, signed, in (-180, 180]. */
function signedSeparation(a: Degrees, b: Degrees): Degrees {
  const raw = norm360(b - a);
  return raw > 180 ? raw - 360 : raw;
}

/** The angular separation between two longitudes, unsigned, in [0, 180]. */
export function angularSeparation(a: Degrees, b: Degrees): Degrees {
  return Math.abs(signedSeparation(a, b));
}

/**
 * Whether the separation between `a` and `b` is closing toward `aspectAngle`
 * (applying) or widening away from it (separating), from their instantaneous
 * longitude speeds.
 *
 * Let `D` be the signed separation from `a` to `b`; its rate of change is
 * `b.longitudeSpeed - a.longitudeSpeed` regardless of which body is "ahead",
 * since normalising `D` into a fixed branch only ever shifts it by a multiple
 * of 360°. `|D|`'s rate is that same quantity signed by `D`'s own sign, and the
 * aspect is applying exactly when that rate pushes `|D|` back toward
 * `aspectAngle` rather than away from it.
 */
function isApplying(a: BodyPosition, b: BodyPosition, aspectAngle: Degrees): boolean {
  const separation = signedSeparation(a.longitude, b.longitude);
  const distanceFromExact = Math.abs(separation) - aspectAngle;
  const separationRate = Math.sign(separation) * (b.longitudeSpeed - a.longitudeSpeed);
  return distanceFromExact * separationRate < 0;
}

export interface AspectMatch {
  readonly aspect: AspectDefinition;
  /** The measured angular separation between the two bodies, in [0, 180]. */
  readonly separation: Degrees;
  /** How far `separation` sits from `aspect.angle`; 0 is an exact hit. */
  readonly orb: Degrees;
  /** True while the aspect is forming; false once it is exact or fading. */
  readonly applying: boolean;
}

/**
 * The closest aspect between two bodies that falls within its configured orb,
 * or `undefined` if none does. When more than one aspect's orb range would
 * cover the same separation (only possible with unusually generous orbs),
 * the one with the smaller orb wins, since that is the more specific claim.
 */
export function matchAspect(
  a: BodyPosition,
  categoryA: BodyCategory,
  b: BodyPosition,
  categoryB: BodyCategory,
  config: OrbConfig = DEFAULT_ORB_CONFIG,
): AspectMatch | undefined {
  const separation = angularSeparation(a.longitude, b.longitude);
  let best: AspectMatch | undefined;
  for (const aspect of ASPECTS) {
    if (aspect.family === 'minor' && !config.enabledMinorAspects.includes(aspect.key)) continue;
    const orb = Math.abs(separation - aspect.angle);
    if (orb > orbFor(aspect.key, categoryA, categoryB, config)) continue;
    if (best !== undefined && orb >= best.orb) continue;
    best = { aspect, separation, orb, applying: isApplying(a, b, aspect.angle) };
  }
  return best;
}

export interface AspectSubject {
  readonly body: BodyId;
  readonly position: BodyPosition;
  readonly category: BodyCategory;
}

export interface Aspect extends AspectMatch {
  readonly bodyA: BodyId;
  readonly bodyB: BodyId;
}

/**
 * Aspect subjects using each position's own real speed — the everyday case
 * for a single chart, or for the moving side of a cross-chart comparison
 * (a progressed, directed, returned or transiting position genuinely moving
 * at that moment).
 */
export function subjectsFrom(
  positions: readonly BodyPosition[],
  categoryOf: (body: BodyId) => BodyCategory,
): readonly AspectSubject[] {
  return positions.map((position) => ({ body: position.body, category: categoryOf(position.body), position }));
}

/**
 * Aspect subjects with speed forced to zero, for the side of a cross-chart
 * comparison being held fixed as a reference — a natal chart being checked
 * against a progression, direction, return or transit. Without this, the
 * fixed side's own speed *at its own moment* (e.g. natal motion at birth)
 * would leak into the applying/separating calculation, which only makes
 * sense relative to the side that is actually moving now.
 */
export function fixedSubjects(
  positions: readonly BodyPosition[],
  categoryOf: (body: BodyId) => BodyCategory,
): readonly AspectSubject[] {
  return positions.map((position) => ({
    body: position.body,
    category: categoryOf(position.body),
    position: { ...position, longitudeSpeed: 0, latitudeSpeed: 0 },
  }));
}

/** Every aspect among a set of bodies, one entry per pair that is in orb. */
export function findAspects(
  subjects: readonly AspectSubject[],
  config: OrbConfig = DEFAULT_ORB_CONFIG,
): readonly Aspect[] {
  const aspects: Aspect[] = [];
  for (let i = 0; i < subjects.length; i++) {
    for (let j = i + 1; j < subjects.length; j++) {
      const subjectA = subjects[i];
      const subjectB = subjects[j];
      if (!subjectA || !subjectB) continue;
      const match = matchAspect(subjectA.position, subjectA.category, subjectB.position, subjectB.category, config);
      if (match) aspects.push({ ...match, bodyA: subjectA.body, bodyB: subjectB.body });
    }
  }
  return aspects;
}

/**
 * Every aspect between two distinct sets of subjects — e.g. a directed or
 * progressed chart against the natal one — checking every pairing between
 * the two lists rather than only i<j within a single one. A body appearing
 * in both lists (its directed self against its own natal self, say) is
 * compared like any other pair: nothing here assumes the two sets are
 * disjoint.
 */
export function findCrossAspects(
  subjectsA: readonly AspectSubject[],
  subjectsB: readonly AspectSubject[],
  config: OrbConfig = DEFAULT_ORB_CONFIG,
): readonly Aspect[] {
  const aspects: Aspect[] = [];
  for (const subjectA of subjectsA) {
    for (const subjectB of subjectsB) {
      const match = matchAspect(subjectA.position, subjectA.category, subjectB.position, subjectB.category, config);
      if (match) aspects.push({ ...match, bodyA: subjectA.body, bodyB: subjectB.body });
    }
  }
  return aspects;
}
