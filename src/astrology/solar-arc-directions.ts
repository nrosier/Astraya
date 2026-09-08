/**
 * Solar arc directions (#47): every body and angle in the natal chart is
 * carried forward by one shared arc — the secondary-progressed Sun's own
 * true motion, `mcArc('solarArc', ...)` from progressions.ts — and checked
 * for contacts to the (unmoving) natal chart.
 *
 * Distinct from secondary progression's own `'solarArc'` MC method even
 * though they share the same arc formula: there the arc only ever rotates
 * the angles, while here it is applied to every body too, which is the
 * entire point of the technique — a directed Mars can conjunct a natal
 * Venus, years before either would meet it any other way.
 */
import { type AspectSubject } from './aspects.js';
import { bodyByKey, type BodyCategory } from './bodies.js';
import { TROPICAL_YEAR_DAYS, ageInYears, mcArc, progressedJulianDay } from './progressions.js';
import type { BodyId, BodyPosition, Degrees, EphemerisProvider, JulianDayUT } from '../ephemeris/types.js';

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** A natal body carried forward by the solar arc. */
export interface DirectedPosition {
  readonly body: BodyId;
  readonly longitude: Degrees;
}

/** Every natal body longitude shifted uniformly by `arc` — the whole-chart direction. */
export function directPositions(natalPositions: readonly BodyPosition[], arc: Degrees): readonly DirectedPosition[] {
  return natalPositions.map((position) => ({ body: position.body, longitude: norm360(position.longitude + arc) }));
}

/**
 * Aspect subjects for the moving, directed side of a directed-to-natal
 * search. `arcSpeed` is the real Sun's own daily motion at the target date —
 * the rate every directed point advances at, since the whole chart moves as
 * one rigid body. Latitude, distance and their speeds are meaningless for a
 * directed point and set to zero; nothing here reads them.
 */
export function directedSubjects(
  directed: readonly DirectedPosition[],
  categoryOf: (body: BodyId) => BodyCategory,
  arcSpeed: Degrees,
): readonly AspectSubject[] {
  return directed.map((position) => ({
    body: position.body,
    category: categoryOf(position.body),
    position: {
      body: position.body,
      longitude: position.longitude,
      latitude: 0,
      distance: 0,
      longitudeSpeed: arcSpeed,
      latitudeSpeed: 0,
      distanceSpeed: 0,
      retrograde: false,
    },
  }));
}

/**
 * Aspect subjects for the fixed, natal side of a directed-to-natal search.
 * Speed is forced to zero regardless of the body's own natal motion: a natal
 * point is not moving *now*, at the target date — it is the stationary
 * target the directed chart is being checked against.
 */
export function fixedNatalSubjects(
  natalPositions: readonly BodyPosition[],
  categoryOf: (body: BodyId) => BodyCategory,
): readonly AspectSubject[] {
  return natalPositions.map((position) => ({
    body: position.body,
    category: categoryOf(position.body),
    position: { ...position, longitudeSpeed: 0, latitudeSpeed: 0 },
  }));
}

/**
 * The (up to two) arc values in [0, 360) at which a directed body reaches
 * exact contact with a fixed natal longitude for the given aspect angle —
 * one for the aspect approached from below, one from above. Pure arithmetic
 * over the natal separation; which of these, if either, falls within a
 * plausible lifetime is for `findExactnessJd` to resolve against the real
 * ephemeris.
 */
export function arcsToExactness(
  directedNatalLongitude: Degrees,
  targetNatalLongitude: Degrees,
  aspectAngle: Degrees,
): readonly Degrees[] {
  const separation = norm360(targetNatalLongitude - directedNatalLongitude);
  const candidates = [norm360(separation - aspectAngle), norm360(separation + aspectAngle)];
  return candidates[0] === candidates[1] ? [candidates[0] ?? 0] : candidates;
}

/**
 * The Julian day at which the real solar arc first reaches `requiredArc`,
 * found by bisection against the ephemeris rather than solved analytically:
 * the true Sun's daily motion varies through the year (about 0.953-1.019
 * deg/day, from orbital eccentricity), so the arc-vs-time function is
 * smooth and monotonic — the Sun never retrogrades — but not perfectly
 * linear. Returns undefined when `requiredArc` is not reached within
 * `searchWindowYears` of age (day-for-year, so that many days past `natalJd`).
 */
export async function findExactnessJd(
  provider: EphemerisProvider,
  natalJd: JulianDayUT,
  natalSunLongitude: Degrees,
  requiredArc: Degrees,
  searchWindowYears = 150,
): Promise<JulianDayUT | undefined> {
  const sun = bodyByKey('sun');
  if (sun === undefined) throw new Error('unreachable: sun is always in BODIES');

  const arcAt = async (jd: JulianDayUT): Promise<Degrees> => {
    const age = ageInYears(natalJd, jd);
    const [position] = await provider.positions(progressedJulianDay(natalJd, jd), [sun.id]);
    if (position === undefined) throw new Error('unreachable: the ephemeris returned no position for the Sun');
    return mcArc('solarArc', age, natalSunLongitude, position.longitude);
  };

  let lo = natalJd;
  let hi = natalJd + searchWindowYears * TROPICAL_YEAR_DAYS;
  if ((await arcAt(hi)) < requiredArc) return undefined;

  for (let i = 0; i < 25; i++) {
    const mid = (lo + hi) / 2;
    if ((await arcAt(mid)) < requiredArc) lo = mid;
    else hi = mid;
  }
  return hi;
}
