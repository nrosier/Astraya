/**
 * Planetary returns and demibirthday (#50).
 *
 * - Returns for any body: Swiss Ephemeris only has dedicated root-finders for
 *   the Sun and Moon (`nextSunCrossing`/`nextMoonCrossing`), so any other body
 *   is found by an iterative crossing search — stepping forward until the
 *   signed distance to the target longitude changes sign, then bisecting
 *   within that bracket, the same style `findExactnessJd` in
 *   `solar-arc-directions.ts` uses for the (also non-root-findable) solar arc.
 * - Demibirthday: the Sun's return to the point exactly opposite its natal
 *   longitude — the real midpoint of the solar year, found the same way as a
 *   solar return, just against `natalSunLongitude + 180` instead.
 * - Progressed lunar return: the moment the real (transiting) Moon crosses
 *   the *secondary-progressed* Moon's longitude for a given target date —
 *   the most recent such crossing at or before that date, since the
 *   progressed Moon itself barely moves (~1°/month of real time) while the
 *   transiting Moon laps it roughly every synodic month.
 */
import { SYNODIC_MONTH_DAYS } from './minor-progressions.js';
import { progressedJulianDay } from './progressions.js';
import type { BodyId, Degrees, EphemerisProvider, JulianDayUT, Zodiac } from '../ephemeris/types.js';
import { SE } from '../ephemeris/generated-constants.js';

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** Smallest signed angle from `from` to `to`, in (-180, 180]. */
function signedDelta(from: Degrees, to: Degrees): Degrees {
  let diff = (to - from) % 360;
  if (diff > 180) diff -= 360;
  if (diff <= -180) diff += 360;
  return diff;
}

async function longitudeAt(
  provider: EphemerisProvider,
  body: BodyId,
  jd: JulianDayUT,
  zodiac: Zodiac | undefined,
): Promise<Degrees> {
  const [position] = await provider.positions(jd, [body], zodiac === undefined ? undefined : { zodiac });
  if (position === undefined) throw new Error(`unreachable: the ephemeris returned no position for body ${body}`);
  return position.longitude;
}

export interface BodyCrossingOptions {
  readonly zodiac?: Zodiac;
  /** Step size for the initial forward scan, in days. Defaults to 1. */
  readonly stepDays?: number;
  /**
   * Upper bound on scan steps before giving up. Defaults to ~33 years at the
   * default step — enough for a Jupiter (~12y) or Saturn (~29.5y) return.
   * A Uranus, Neptune, or Pluto return needs an explicit larger value.
   */
  readonly maxSteps?: number;
}

async function bisectCrossing(
  provider: EphemerisProvider,
  body: BodyId,
  lo: JulianDayUT,
  hi: JulianDayUT,
  // The caller's scan loop already evaluated the longitude at `lo` as its
  // own bracket check; passing that delta in instead of refetching it here
  // saves one ephemeris round-trip per crossing search.
  deltaLo: Degrees,
  targetLongitude: Degrees,
  zodiac: Zodiac | undefined,
): Promise<JulianDayUT> {
  let a = lo;
  let b = hi;
  let deltaA = deltaLo;

  for (let i = 0; i < 30; i++) {
    const mid = (a + b) / 2;
    const deltaMid = signedDelta(await longitudeAt(provider, body, mid, zodiac), targetLongitude);
    if (deltaMid === 0) return mid;
    if (Math.sign(deltaMid) === Math.sign(deltaA)) {
      a = mid;
      deltaA = deltaMid;
    } else {
      b = mid;
    }
  }
  return b;
}

/**
 * The next Julian day, searching forward from `fromJd`, at which `body`
 * crosses `targetLongitude` — found by stepping forward until the signed
 * distance to the target changes sign, then bisecting within that bracket.
 * Works for any body, including one that is retrograde at the time: motion
 * is still one direction across any single short step, even if the body's
 * longer path loops back later.
 */
export async function nextBodyCrossing(
  provider: EphemerisProvider,
  body: BodyId,
  targetLongitude: Degrees,
  fromJd: JulianDayUT,
  options: BodyCrossingOptions = {},
): Promise<JulianDayUT> {
  const stepDays = options.stepDays ?? 1;
  const maxSteps = options.maxSteps ?? 12000;

  let lo = fromJd;
  let deltaLo = signedDelta(await longitudeAt(provider, body, lo, options.zodiac), targetLongitude);
  if (deltaLo === 0) return lo;

  for (let step = 0; step < maxSteps; step++) {
    const hi = lo + stepDays;
    const deltaHi = signedDelta(await longitudeAt(provider, body, hi, options.zodiac), targetLongitude);

    if (deltaHi === 0) return hi;
    // A genuine crossing flips sign via a *small* change in delta. A sign flip
    // caused by `signedDelta`'s own wraparound at ±180° (the point opposite
    // the target, where the delta jumps from near -180 to near +180 as the
    // body sails past it) produces a large change instead — not a crossing.
    if (Math.sign(deltaLo) !== Math.sign(deltaHi) && Math.abs(deltaHi - deltaLo) < 180) {
      return bisectCrossing(provider, body, lo, hi, deltaLo, targetLongitude, options.zodiac);
    }
    lo = hi;
    deltaLo = deltaHi;
  }

  throw new Error(
    `nextBodyCrossing: no crossing of ${targetLongitude}° found for body ${body} within ${maxSteps * stepDays} days of ${fromJd}`,
  );
}

/**
 * The next return of `body` to `natalLongitude`, searching forward from
 * `fromJd`. Dispatches to the exact Swiss Ephemeris root-finders for the Sun
 * and Moon, and to the generic iterative search for every other body.
 */
export async function nextReturnOfBody(
  provider: EphemerisProvider,
  body: BodyId,
  natalLongitude: Degrees,
  fromJd: JulianDayUT,
  zodiac?: Zodiac,
): Promise<JulianDayUT> {
  if (body === SE.SE_SUN) return provider.nextSunCrossing(fromJd, natalLongitude, zodiac);
  if (body === SE.SE_MOON) return provider.nextMoonCrossing(fromJd, natalLongitude, zodiac);
  return nextBodyCrossing(provider, body, natalLongitude, fromJd, zodiac === undefined ? {} : { zodiac });
}

/**
 * The demibirthday within a given calendar year: the Sun's return to the
 * point exactly opposite its natal longitude. Mirrors `solarReturnInYear`'s
 * own search-from-Jan-1 approach for the same reason — it is robust
 * regardless of where in the year the demibirthday falls.
 */
export async function demibirthdayInYear(
  provider: EphemerisProvider,
  natalSunLongitude: Degrees,
  year: number,
  zodiac?: Zodiac,
): Promise<JulianDayUT> {
  const oppositeLongitude = norm360(natalSunLongitude + 180);
  const searchStart = await provider.julianDay(year, 1, 1, 0);
  return provider.nextSunCrossing(searchStart, oppositeLongitude, zodiac);
}

/**
 * The most recent progressed lunar return at or before `targetJd`: the last
 * moment the real Moon crossed `progressedMoonLongitude` (the
 * secondary-progressed Moon's longitude as of `targetJd`) on or before that
 * date. Searches back a full synodic month to guarantee at least one
 * crossing is bracketed, then walks forward taking the last crossing that
 * does not exceed `targetJd`.
 */
export async function progressedLunarReturnOnOrBefore(
  provider: EphemerisProvider,
  progressedMoonLongitude: Degrees,
  targetJd: JulianDayUT,
  zodiac?: Zodiac,
): Promise<JulianDayUT> {
  const epsilonDays = 0.01;
  let searchFrom = targetJd - SYNODIC_MONTH_DAYS;
  let found: JulianDayUT | undefined;

  for (;;) {
    const next = await provider.nextMoonCrossing(searchFrom, progressedMoonLongitude, zodiac);
    if (next > targetJd) break;
    found = next;
    searchFrom = next + epsilonDays;
  }

  if (found === undefined) {
    throw new Error(`progressedLunarReturnOnOrBefore: no crossing found within a synodic month before ${targetJd}`);
  }
  return found;
}

/** The secondary-progressed Moon's longitude as of `targetJd` (day-for-year). */
export async function progressedMoonLongitude(
  provider: EphemerisProvider,
  natalJd: JulianDayUT,
  targetJd: JulianDayUT,
  zodiac?: Zodiac,
): Promise<Degrees> {
  const progressedJd = progressedJulianDay(natalJd, targetJd);
  return longitudeAt(provider, SE.SE_MOON, progressedJd, zodiac);
}
