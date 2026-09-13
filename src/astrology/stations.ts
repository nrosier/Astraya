/**
 * Station events (#207's daily tier): the Julian day(s) within a window at
 * which a body's longitude speed crosses zero — the moment it turns
 * retrograde (about to move backward) or direct (about to resume forward).
 *
 * Structurally the same search as `transit-events.ts` (sample, find a sign
 * change, bisect to a second), just over `longitudeSpeed` instead of a
 * longitude-to-target delta, so it doesn't need the two-targets-per-aspect or
 * branch-cut handling that module's crossings do — a speed crossing zero is
 * unambiguous.
 *
 * Scoped to the eight `'planet'`-category bodies (Mercury through Pluto): the
 * Sun's longitude speed never crosses zero (Earth's orbit doesn't reverse),
 * and the Moon's speed varies but likewise never goes negative, so neither
 * luminary can station. Nodes and Lilith variants are oscillating orbital
 * elements rather than planets in the sense "station" is normally used for,
 * so this module isn't asked to cover them.
 */
import type { BodyId, Degrees, EphemerisProvider, JulianDayUT, PositionOptions, Zodiac } from '../ephemeris/types.js';

export interface StationEvent {
  readonly jd: JulianDayUT;
  readonly body: BodyId;
  /** 'retrograde': speed just went negative (turning backward). 'direct': speed just went positive (resuming forward). */
  readonly direction: 'retrograde' | 'direct';
}

/** Same step `transit-events.ts` uses, for the same reason: safe for any body slower than the Moon. */
export const DEFAULT_SAMPLE_STEP_DAYS = 0.5;

const BISECTION_TOLERANCE_DAYS = 1 / 86400;

async function bisectSpeedZero(
  provider: EphemerisProvider,
  body: BodyId,
  t0: JulianDayUT,
  t1: JulianDayUT,
  s0: Degrees,
  positionOptions: PositionOptions | undefined,
): Promise<JulianDayUT> {
  let lo = t0;
  let hi = t1;
  let speedAtLo = s0;
  while (hi - lo > BISECTION_TOLERANCE_DAYS) {
    const mid = (lo + hi) / 2;
    const sample = await provider.position(mid, body, positionOptions);
    const speedAtMid = sample.longitudeSpeed;
    if (speedAtMid === 0) return mid;
    if (speedAtMid > 0 === speedAtLo > 0) {
      lo = mid;
      speedAtLo = speedAtMid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

function sampleJds(fromJd: JulianDayUT, toJd: JulianDayUT, step: number): readonly JulianDayUT[] {
  const jds: JulianDayUT[] = [];
  for (let t = fromJd; t < toJd; t += step) jds.push(t);
  jds.push(toJd);
  return jds;
}

export interface FindStationsOptions {
  readonly zodiac?: Zodiac;
  readonly sampleStepDays?: number;
}

/** Every station any of `bodies` makes within `[fromJd, toJd]`, in chronological order. */
export async function findStations(
  provider: EphemerisProvider,
  bodies: readonly BodyId[],
  fromJd: JulianDayUT,
  toJd: JulianDayUT,
  options: FindStationsOptions = {},
): Promise<readonly StationEvent[]> {
  if (toJd < fromJd) throw new RangeError('toJd must not be before fromJd');
  const step = options.sampleStepDays ?? DEFAULT_SAMPLE_STEP_DAYS;
  const positionOptions: PositionOptions | undefined =
    options.zodiac === undefined ? undefined : { zodiac: options.zodiac };

  const jds = sampleJds(fromJd, toJd, step);
  const samplesAtEachJd = await Promise.all(jds.map((jd) => provider.positions(jd, bodies, positionOptions)));

  const events: StationEvent[] = [];

  for (let bodyIndex = 0; bodyIndex < bodies.length; bodyIndex++) {
    const body = bodies[bodyIndex];
    if (body === undefined) continue;
    const speeds = samplesAtEachJd.map((sample) => sample[bodyIndex]?.longitudeSpeed);

    for (let i = 0; i < speeds.length - 1; i++) {
      const s0 = speeds[i];
      const s1 = speeds[i + 1];
      if (s0 === undefined || s1 === undefined) continue;

      if (s0 === 0) {
        const jd = jds[i];
        if (jd === undefined) continue;
        events.push({ jd, body, direction: s1 < 0 ? 'retrograde' : 'direct' });
        continue;
      }

      const sameSign = s0 > 0 === s1 > 0;
      if (sameSign) continue;

      const t0 = jds[i];
      const t1 = jds[i + 1];
      if (t0 === undefined || t1 === undefined) continue;
      const jd = await bisectSpeedZero(provider, body, t0, t1, s0, positionOptions);
      events.push({ jd, body, direction: s0 > 0 ? 'retrograde' : 'direct' });
    }
  }

  return [...events].sort((a, b) => a.jd - b.jd);
}
