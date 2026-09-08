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
 * Orb configuration: a base orb per aspect, widened when either body in the
 * pair is a luminary (Sun or Moon) — the traditional allowance for how much
 * more an aspect involving a luminary is felt to "reach".
 *
 * Base orbs default to the customary tight-minor/wide-major split; both the
 * table and the bonus are plain data so a caller can override either without
 * touching this module.
 */
export interface OrbConfig {
  readonly baseOrbs: Readonly<Record<string, Degrees>>;
  readonly luminaryBonus: Degrees;
}

export const DEFAULT_ORB_CONFIG: OrbConfig = {
  baseOrbs: {
    conjunction: 8,
    opposition: 8,
    square: 7,
    trine: 7,
    sextile: 5,
    semisextile: 2,
    semisquare: 2,
    sesquiquadrate: 2,
    quincunx: 2,
    quintile: 1,
    biquintile: 1,
  },
  luminaryBonus: 2,
};

export function orbFor(
  aspectKey: string,
  categoryA: BodyCategory,
  categoryB: BodyCategory,
  config: OrbConfig = DEFAULT_ORB_CONFIG,
): Degrees {
  const base = config.baseOrbs[aspectKey];
  if (base === undefined) {
    throw new RangeError(`no orb configured for aspect "${aspectKey}"`);
  }
  const hasLuminary = categoryA === 'luminary' || categoryB === 'luminary';
  return hasLuminary ? base + config.luminaryBonus : base;
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
    if (config.baseOrbs[aspect.key] === undefined) continue; // not configured: not considered
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
