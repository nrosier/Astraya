/**
 * Exact aspects between two bodies that are *both* moving (#410): the planetary cycles —
 * Jupiter-Saturn's roughly twenty-year "great conjunction", Venus's inferior conjunctions that
 * trace a pentagram over eight years — independent of any natal chart.
 *
 * `transit-events.ts` finds one moving body reaching a fixed natal longitude. This is the same
 * sample-then-bisect idea with the target itself in motion: the quantity tracked is the signed
 * distance of body A from the point at the aspect angle to body B (`B + offset`), and an exact
 * aspect is that distance passing through zero. Because the target moves, *both* bodies are
 * re-queried at every bisection step, not just one.
 *
 * An aspect other than the conjunction (0°) or opposition (180°) is exact at two relative
 * positions — A can be `angle` ahead of B or `angle` behind it — so those are searched
 * separately; the conjunction and opposition are their own mirror image and have one.
 *
 * Sampling at a fixed step is safe for the same reason it is in `transit-events.ts`: the step is
 * chosen from the faster of the two bodies, and a pair's exact-aspect crossings (including the
 * direct/retrograde/direct triple a retrograde loop produces) are weeks to months apart, never
 * two inside one sample interval.
 */
import { ASPECTS, type AspectDefinition } from './aspects.js';
import type { BodyId, Degrees, EphemerisProvider, JulianDayUT, PositionOptions, Zodiac } from '../ephemeris/types.js';

/** Bisection stops once the bracket is narrower than this — about one second. */
const BISECTION_TOLERANCE_DAYS = 1 / 86400;

/** Refuse a search that would need more samples than this: it would freeze a browser tab, not finish. */
export const MAX_MUTUAL_SAMPLES = 60_000;

/** Samples fetched per batch, so a long search does not queue tens of thousands of requests at once. */
const BATCH_SIZE = 500;

/**
 * How often to sample a body, in days: fine enough that no crossing involving it can hide
 * between two samples. The Moon covers ~13°/day; the outer planets under a degree in months.
 */
const STEP_DAYS_BY_BODY_KEY: Readonly<Record<string, number>> = {
  moon: 1 / 24,
  mercury: 0.5,
  venus: 1,
  sun: 1,
  mars: 1,
  jupiter: 5,
  saturn: 5,
  chiron: 5,
  uranus: 15,
  neptune: 15,
  pluto: 15,
};
const DEFAULT_STEP_DAYS = 2;

export interface MutualAspectEvent {
  /** The moment the aspect is exact. */
  readonly jd: JulianDayUT;
  readonly aspect: AspectDefinition;
  /** Body A's longitude at that moment (for a conjunction, also body B's). */
  readonly longitudeA: Degrees;
  readonly longitudeB: Degrees;
  readonly retrogradeA: boolean;
  readonly retrogradeB: boolean;
}

export interface MutualAspectOptions {
  readonly zodiac?: Zodiac;
  /** Aspect keys to look for. Defaults to the conjunction alone — the cycle's own marker. */
  readonly aspectKeys?: readonly string[];
  /** `BodyDefinition.key` of A and B, used to pick a sample step. Optional: without them the step is two days. */
  readonly bodyKeys?: readonly [string, string];
  /** Overrides the step chosen from the bodies. Exposed mainly for tests. */
  readonly sampleStepDays?: number;
}

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** Signed angular distance from `from` to `to`, in (-180, 180]. Zero exactly when they coincide. */
function signedDelta(from: Degrees, to: Degrees): Degrees {
  const raw = norm360(to - from);
  return raw > 180 ? raw - 360 : raw;
}

/** Offsets from B at which A makes `angle` to it: one for 0° and 180°, two otherwise. */
function offsetsFor(angle: Degrees): readonly Degrees[] {
  return angle === 0 || angle === 180 ? [angle] : [angle, -angle];
}

/** The step a pair needs: the finer of its two bodies', since the faster one drives the relative motion. */
export function defaultSampleStepDays(bodyKeys?: readonly [string, string]): number {
  if (bodyKeys === undefined) return DEFAULT_STEP_DAYS;
  return Math.min(...bodyKeys.map((key) => STEP_DAYS_BY_BODY_KEY[key] ?? DEFAULT_STEP_DAYS));
}

/**
 * Every exact aspect of the chosen kinds between `bodyA` and `bodyB` in `[fromJd, toJd]`, in
 * chronological order.
 */
export async function findMutualAspects(
  provider: EphemerisProvider,
  bodyA: BodyId,
  bodyB: BodyId,
  fromJd: JulianDayUT,
  toJd: JulianDayUT,
  options: MutualAspectOptions = {},
): Promise<readonly MutualAspectEvent[]> {
  if (toJd < fromJd) throw new RangeError('toJd must not be before fromJd');
  if (bodyA === bodyB) throw new RangeError('a body makes no aspect to itself');
  const positionOptions: PositionOptions | undefined =
    options.zodiac === undefined ? undefined : { zodiac: options.zodiac };
  const wanted = options.aspectKeys ?? ['conjunction'];
  const aspects = ASPECTS.filter((aspect) => wanted.includes(aspect.key));
  const step = options.sampleStepDays ?? defaultSampleStepDays(options.bodyKeys);

  const jds: JulianDayUT[] = [];
  for (let t = fromJd; t < toJd; t += step) jds.push(t);
  jds.push(toJd);
  if (jds.length > MAX_MUTUAL_SAMPLES) {
    throw new RangeError(
      `This search needs ${String(jds.length)} samples, more than the ${String(MAX_MUTUAL_SAMPLES)} allowed — shorten the range.`,
    );
  }

  const samples: (readonly [number, number, boolean, boolean])[] = [];
  for (let start = 0; start < jds.length; start += BATCH_SIZE) {
    const batch = await Promise.all(
      jds.slice(start, start + BATCH_SIZE).map(async (jd) => {
        const [a, b] = await provider.positions(jd, [bodyA, bodyB], positionOptions);
        if (a === undefined || b === undefined) throw new Error('unreachable: positions returns one per body');
        return [a.longitude, b.longitude, a.retrograde, b.retrograde] as const;
      }),
    );
    samples.push(...batch);
  }

  const distanceAt = async (jd: JulianDayUT, offset: Degrees): Promise<Degrees> => {
    const [a, b] = await provider.positions(jd, [bodyA, bodyB], positionOptions);
    if (a === undefined || b === undefined) throw new Error('unreachable: positions returns one per body');
    return signedDelta(a.longitude, norm360(b.longitude + offset));
  };

  const events: MutualAspectEvent[] = [];
  const record = async (jd: JulianDayUT, aspect: AspectDefinition): Promise<void> => {
    const [a, b] = await provider.positions(jd, [bodyA, bodyB], positionOptions);
    if (a === undefined || b === undefined) throw new Error('unreachable: positions returns one per body');
    events.push({
      jd,
      aspect,
      longitudeA: a.longitude,
      longitudeB: b.longitude,
      retrogradeA: a.retrograde,
      retrogradeB: b.retrograde,
    });
  };

  for (const aspect of aspects) {
    for (const offset of offsetsFor(aspect.angle)) {
      const diffs = samples.map(([longitudeA, longitudeB]) => signedDelta(longitudeA, norm360(longitudeB + offset)));
      for (let i = 0; i < diffs.length - 1; i++) {
        const d0 = diffs[i];
        const d1 = diffs[i + 1];
        const t0 = jds[i];
        const t1 = jds[i + 1];
        if (d0 === undefined || d1 === undefined || t0 === undefined || t1 === undefined) continue;
        if (d0 === 0) {
          await record(t0, aspect);
          continue;
        }
        // A sign change near ±180 is `signedDelta` wrapping past its branch cut (A passing the
        // point opposite its target), not a crossing.
        if (d0 > 0 === d1 > 0 || Math.abs(d0 - d1) >= 180) continue;
        let lo = t0;
        let hi = t1;
        let fLo = d0;
        while (hi - lo > BISECTION_TOLERANCE_DAYS) {
          const mid = (lo + hi) / 2;
          const fMid = await distanceAt(mid, offset);
          if (fMid === 0) {
            lo = mid;
            hi = mid;
            break;
          }
          if (fMid > 0 === fLo > 0) {
            lo = mid;
            fLo = fMid;
          } else {
            hi = mid;
          }
        }
        await record((lo + hi) / 2, aspect);
      }
    }
  }

  return events.sort((a, b) => a.jd - b.jd);
}
