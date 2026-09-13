/**
 * Exact transit-to-natal aspect events (#207): the Julian day(s) within a
 * window at which a transiting body's longitude reaches an exact aspect to a
 * fixed natal longitude.
 *
 * `solar-lunar-returns.ts` finds this same kind of event — a moving
 * longitude hitting one fixed target — for the Sun and Moon, using Swiss
 * Ephemeris's own `nextSunCrossing`/`nextMoonCrossing` root-finders. No such
 * root-finder exists for any other body, so this module hand-rolls the same
 * idea generically: sample the body's longitude across the window, find
 * every sample-to-sample interval where it crosses a target longitude, then
 * bisect within that interval down to second-level precision.
 *
 * An aspect other than conjunction (0°) or opposition (180°) names *two*
 * target longitudes on the circle (`natal + angle` and `natal - angle`), not
 * one — a trine to a natal point at 10° Aries is exact at both 10° Gemini
 * and 10° Sagittarius. `targetLongitudes` enumerates both; conjunction and
 * opposition, which are their own mirror image, enumerate only one.
 *
 * Sampling at a fixed step (`DEFAULT_SAMPLE_STEP_DAYS`) rather than adapting
 * to each body's speed is deliberate: every body this module is meant for
 * (Sun through Pluto — the Moon moves far too fast for a weekly/monthly
 * tier and is handled separately, per #207's daily-tier design) moves at
 * most a few degrees a day, so half a day is comfortably fine enough to
 * catch every crossing without missing one, including the closely-spaced
 * direct/retrograde/direct triple-crossing of a retrograde "shadow" period —
 * those three crossings are always weeks apart, not within one sample
 * interval. The one thing this cannot catch is two crossings of the *same*
 * target within a single sample interval, which for these bodies at this
 * step size does not happen.
 */
import { ASPECTS, DEFAULT_ORB_CONFIG, type AspectDefinition, type OrbConfig } from './aspects.js';
import type { BodyId, Degrees, EphemerisProvider, JulianDayUT, PositionOptions, Zodiac } from '../ephemeris/types.js';

/** One exact transit-to-natal aspect, at the moment it is exact. */
export interface TransitAspectEvent {
  readonly jd: JulianDayUT;
  readonly transitingBody: BodyId;
  readonly natalBody: BodyId;
  readonly aspect: AspectDefinition;
  /** Whether the transiting body is retrograde at this exact moment. */
  readonly retrograde: boolean;
}

/** Default sampling step for the crossing search — see the file doc for why this is safe. */
export const DEFAULT_SAMPLE_STEP_DAYS = 0.5;

/** Bisection stops once the bracket is narrower than this — about one second. */
const BISECTION_TOLERANCE_DAYS = 1 / 86400;

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** Signed angular distance from `from` to `to`, in (-180, 180]. Zero exactly when they coincide. */
function signedDelta(from: Degrees, to: Degrees): Degrees {
  const raw = norm360(to - from);
  return raw > 180 ? raw - 360 : raw;
}

/**
 * The one or two longitudes at which `aspect.angle` from `natalLongitude` is
 * exact. Conjunction and opposition have a single target; every other
 * aspect has two, symmetric around the natal point.
 */
export function targetLongitudes(aspectAngle: Degrees, natalLongitude: Degrees): readonly Degrees[] {
  if (aspectAngle === 0) return [norm360(natalLongitude)];
  if (aspectAngle === 180) return [norm360(natalLongitude + 180)];
  return [norm360(natalLongitude + aspectAngle), norm360(natalLongitude - aspectAngle)];
}

/** Mirrors `matchAspect`'s own gating: every major aspect, plus any minor explicitly enabled. */
function enabledAspects(config: OrbConfig): readonly AspectDefinition[] {
  return ASPECTS.filter((aspect) => aspect.family === 'major' || config.enabledMinorAspects.includes(aspect.key));
}

/** Julian days from `fromJd` to `toJd` inclusive, `step` apart, always ending exactly on `toJd`. */
function sampleJds(fromJd: JulianDayUT, toJd: JulianDayUT, step: number): readonly JulianDayUT[] {
  const jds: JulianDayUT[] = [];
  for (let t = fromJd; t < toJd; t += step) jds.push(t);
  jds.push(toJd);
  return jds;
}

/**
 * Refines a bracketed sign change `[t0, t1]` (where `f(t0)` and `f(t1)` have
 * opposite, non-zero sign) down to `BISECTION_TOLERANCE_DAYS`, re-querying
 * the ephemeris at each midpoint — the same idea Swiss Ephemeris's own
 * `nextSunCrossing` uses internally, exposed here for a body it doesn't
 * cover.
 */
async function bisectCrossing(
  provider: EphemerisProvider,
  body: BodyId,
  target: Degrees,
  t0: JulianDayUT,
  t1: JulianDayUT,
  f0: Degrees,
  positionOptions: PositionOptions | undefined,
): Promise<JulianDayUT> {
  let lo = t0;
  let hi = t1;
  let fLo = f0;
  while (hi - lo > BISECTION_TOLERANCE_DAYS) {
    const mid = (lo + hi) / 2;
    const sample = await provider.position(mid, body, positionOptions);
    const fMid = signedDelta(sample.longitude, target);
    if (fMid === 0) return mid;
    if (fMid > 0 === fLo > 0) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

export interface FindExactTransitAspectsOptions {
  readonly zodiac?: Zodiac;
  readonly orbConfig?: OrbConfig;
  /** Overrides `DEFAULT_SAMPLE_STEP_DAYS`. Exposed mainly for tests that want a coarser/finer search. */
  readonly sampleStepDays?: number;
}

/**
 * Every exact aspect any of `transitingBodies` makes to any of
 * `natalLongitudes` within `[fromJd, toJd]`, in chronological order.
 *
 * One ephemeris round trip per sample point (all `transitingBodies` fetched
 * together via `positions`), plus a handful more per crossing actually
 * found for the bisection refinement — the combinatorial fan-out over
 * natal bodies, aspects and the two targets per aspect is pure arithmetic
 * over the already-fetched samples, not additional ephemeris calls.
 */
export async function findExactTransitAspects(
  provider: EphemerisProvider,
  transitingBodies: readonly BodyId[],
  natalLongitudes: ReadonlyMap<BodyId, Degrees>,
  fromJd: JulianDayUT,
  toJd: JulianDayUT,
  options: FindExactTransitAspectsOptions = {},
): Promise<readonly TransitAspectEvent[]> {
  if (toJd < fromJd) throw new RangeError('toJd must not be before fromJd');
  const config = options.orbConfig ?? DEFAULT_ORB_CONFIG;
  const aspects = enabledAspects(config);
  const step = options.sampleStepDays ?? DEFAULT_SAMPLE_STEP_DAYS;
  const positionOptions: PositionOptions | undefined =
    options.zodiac === undefined ? undefined : { zodiac: options.zodiac };

  const jds = sampleJds(fromJd, toJd, step);
  const samplesAtEachJd = await Promise.all(jds.map((jd) => provider.positions(jd, transitingBodies, positionOptions)));

  const events: TransitAspectEvent[] = [];

  for (let bodyIndex = 0; bodyIndex < transitingBodies.length; bodyIndex++) {
    const transitingBody = transitingBodies[bodyIndex];
    if (transitingBody === undefined) continue;
    const longitudes = samplesAtEachJd.map((sample) => sample[bodyIndex]?.longitude);

    for (const [natalBody, natalLongitude] of natalLongitudes) {
      for (const aspect of aspects) {
        for (const target of targetLongitudes(aspect.angle, natalLongitude)) {
          const diffs = longitudes.map((longitude) =>
            longitude === undefined ? undefined : signedDelta(longitude, target),
          );

          for (let i = 0; i < diffs.length - 1; i++) {
            const d0 = diffs[i];
            const d1 = diffs[i + 1];
            if (d0 === undefined || d1 === undefined) continue;

            if (d0 === 0) {
              const jd = jds[i];
              if (jd === undefined) continue;
              const speed = samplesAtEachJd[i]?.[bodyIndex]?.longitudeSpeed ?? 0;
              events.push({ jd, transitingBody, natalBody, aspect, retrograde: speed < 0 });
              continue;
            }

            const sameSign = d0 > 0 === d1 > 0;
            if (sameSign) continue;
            // A sign change near +-180 is the difference wrapping past the branch cut
            // (the body passing target+180, not target) rather than a real crossing.
            if (Math.abs(d0 - d1) >= 180) continue;

            const t0 = jds[i];
            const t1 = jds[i + 1];
            if (t0 === undefined || t1 === undefined) continue;
            const jd = await bisectCrossing(provider, transitingBody, target, t0, t1, d0, positionOptions);
            const finalPosition = await provider.position(jd, transitingBody, positionOptions);
            events.push({ jd, transitingBody, natalBody, aspect, retrograde: finalPosition.longitudeSpeed < 0 });
          }
        }
      }
    }
  }

  return [...events].sort((a, b) => a.jd - b.jd);
}
