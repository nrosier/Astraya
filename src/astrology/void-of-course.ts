/**
 * Void-of-course Moon (#402): whether the Moon, at a given moment, has made its last exact
 * aspect before leaving its sign — and so is "void" until it enters the next.
 *
 * Convention, stated rather than picked silently (traditions disagree, and a result that changes
 * with the convention should say which one it used):
 *
 * - **Aspects:** the five Ptolemaic aspects — conjunction, sextile, square, trine, opposition.
 *   Minor aspects do not end a void period. Orbs play no part: an aspect counts at the moment it
 *   is *exact*, which is what "perfects" means; the Moon is not "applying" its way out of the void.
 * - **Bodies:** the Sun and the planets Mercury through Pluto (the default of Astro-Seek's
 *   calculator). A traditional practitioner who counts only the classical seven (through Saturn)
 *   can pass `bodies` for that; the outer planets are included by default because modern
 *   practice does.
 * - **Void period:** from the Moon's last exact aspect inside its current sign (or, if it made
 *   none yet, from the moment it entered the sign) until it enters the next sign. The Moon is
 *   void at a moment exactly when no further aspect perfects before that ingress.
 *
 * The Moon never moves backwards, so it crosses each of these targets at most once per sign, and
 * a sign takes it between roughly two and three days. Within that window the search samples the
 * Moon and every candidate body hourly — the Moon covers about half a degree an hour, so it cannot
 * cross a target and come back between samples — then bisects each sign change down to a second,
 * the same approach `transit-events.ts` uses for a transit to a fixed point, except that here the
 * "target" (another planet) moves too, so the planet is re-queried at every midpoint. Sign
 * entry and exit come from Swiss Ephemeris' own `nextMoonCrossing`.
 */
import { ASPECTS, type AspectDefinition } from './aspects.js';
import { bodyByKey } from './bodies.js';
import type { BodyId, Degrees, EphemerisProvider, JulianDayUT, PositionOptions, Zodiac } from '../ephemeris/types.js';

/** How far apart the search samples the Moon and the other bodies. */
const SAMPLE_STEP_DAYS = 1 / 24;
/** Bisection stops once the bracket is narrower than this — about one second. */
const BISECTION_TOLERANCE_DAYS = 1 / 86400;
/** A full pass through any sign takes the Moon under three days (it never moves slower than ~11.7°/day). */
const MAX_SIGN_DAYS = 3;

/** The Sun and Mercury through Pluto — see the file doc for why not the classical seven alone. */
const DEFAULT_BODY_KEYS = [
  'sun',
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
  'pluto',
] as const;

export interface MoonAspectEvent {
  /** The moment the aspect is exact. */
  readonly jd: JulianDayUT;
  readonly body: BodyId;
  readonly aspect: AspectDefinition;
}

export interface VoidOfCourseMoon {
  /** The moment this describes. */
  readonly jd: JulianDayUT;
  /** The Moon's sign at `jd`, 0 = Aries … 11 = Pisces (in the requested zodiac). */
  readonly signIndex: number;
  /** When the Moon entered that sign. */
  readonly signEntryJd: JulianDayUT;
  /** When the Moon leaves it for the next. */
  readonly signExitJd: JulianDayUT;
  readonly isVoid: boolean;
  /** The last exact aspect at or before `jd` within this sign, if the Moon has made any yet. */
  readonly lastAspect: MoonAspectEvent | undefined;
  /** The next exact aspect after `jd` within this sign — `undefined` exactly when the Moon is void. */
  readonly nextAspect: MoonAspectEvent | undefined;
  /** When the current void period began (the last aspect, or the sign entry); `undefined` unless void. */
  readonly voidFromJd: JulianDayUT | undefined;
}

export interface VoidOfCourseOptions {
  readonly zodiac?: Zodiac;
  /** Which bodies' aspects count. Defaults to the Sun and Mercury through Pluto. */
  readonly bodies?: readonly BodyId[];
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

function defaultBodies(): readonly BodyId[] {
  return DEFAULT_BODY_KEYS.flatMap((key) => {
    const body = bodyByKey(key);
    return body === undefined ? [] : [body.id];
  });
}

/** Offsets from a body at which the Moon makes the given aspect to it: one for 0° and 180°, two otherwise. */
function offsetsFor(aspectAngle: Degrees): readonly Degrees[] {
  return aspectAngle === 0 || aspectAngle === 180 ? [aspectAngle] : [aspectAngle, -aspectAngle];
}

/**
 * Every exact Ptolemaic aspect the Moon makes to `bodies` in `[fromJd, toJd]`, in order.
 *
 * `f(t)` is the Moon's signed distance from the aspect point (`body + offset`); a sign change
 * between two samples is a crossing, except when the two values straddle ±180° — that is the
 * branch cut of `signedDelta` (the Moon passing the point opposite the target), not a crossing.
 */
async function findMoonAspects(
  provider: EphemerisProvider,
  moon: BodyId,
  bodies: readonly BodyId[],
  fromJd: JulianDayUT,
  toJd: JulianDayUT,
  positionOptions: PositionOptions | undefined,
): Promise<readonly MoonAspectEvent[]> {
  const aspects = ASPECTS.filter((aspect) => aspect.family === 'major');
  const jds: JulianDayUT[] = [];
  for (let t = fromJd; t < toJd; t += SAMPLE_STEP_DAYS) jds.push(t);
  jds.push(toJd);

  const all = [moon, ...bodies];
  const samples = await Promise.all(jds.map((jd) => provider.positions(jd, all, positionOptions)));

  const distanceAt = async (jd: JulianDayUT, body: BodyId, offset: Degrees): Promise<Degrees> => {
    const [moonAt, bodyAt] = await provider.positions(jd, [moon, body], positionOptions);
    if (moonAt === undefined || bodyAt === undefined) throw new Error('unreachable: positions returns one per body');
    return signedDelta(moonAt.longitude, norm360(bodyAt.longitude + offset));
  };

  const events: MoonAspectEvent[] = [];
  for (let bodyIndex = 0; bodyIndex < bodies.length; bodyIndex++) {
    const body = bodies[bodyIndex];
    if (body === undefined) continue;
    for (const aspect of aspects) {
      for (const offset of offsetsFor(aspect.angle)) {
        const diffs = samples.map((sample) => {
          const moonLongitude = sample[0]?.longitude;
          const bodyLongitude = sample[bodyIndex + 1]?.longitude;
          return moonLongitude === undefined || bodyLongitude === undefined
            ? undefined
            : signedDelta(moonLongitude, norm360(bodyLongitude + offset));
        });
        for (let i = 0; i < diffs.length - 1; i++) {
          const d0 = diffs[i];
          const d1 = diffs[i + 1];
          const t0 = jds[i];
          const t1 = jds[i + 1];
          if (d0 === undefined || d1 === undefined || t0 === undefined || t1 === undefined) continue;
          if (d0 === 0) {
            events.push({ jd: t0, body, aspect });
            continue;
          }
          if (d0 > 0 === d1 > 0) continue;
          if (Math.abs(d0 - d1) >= 180) continue;
          let lo = t0;
          let hi = t1;
          let fLo = d0;
          while (hi - lo > BISECTION_TOLERANCE_DAYS) {
            const mid = (lo + hi) / 2;
            const fMid = await distanceAt(mid, body, offset);
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
          events.push({ jd: (lo + hi) / 2, body, aspect });
        }
      }
    }
  }
  return [...events].sort((a, b) => a.jd - b.jd);
}

/**
 * Everything about one pass of the Moon through a sign that the void-of-course question needs:
 * when it entered and leaves, and every exact aspect it makes in between. Computed once, it
 * answers "is the Moon void at this moment?" for *any* moment in the sign — which is what lets a
 * search across days (`electional.ts`) ask it thousands of times without repeating the scan.
 */
export interface MoonSignWindow {
  /** The Moon's sign, 0 = Aries … 11 = Pisces (in the requested zodiac). */
  readonly signIndex: number;
  readonly signEntryJd: JulianDayUT;
  readonly signExitJd: JulianDayUT;
  /** Every exact aspect the Moon makes while in the sign, in order. */
  readonly events: readonly MoonAspectEvent[];
}

/** The pass of the Moon through its sign that contains `jd`, with every aspect it makes in it. */
export async function findMoonSignWindow(
  provider: EphemerisProvider,
  jd: JulianDayUT,
  options: VoidOfCourseOptions = {},
): Promise<MoonSignWindow> {
  const moon = bodyByKey('moon');
  if (moon === undefined) throw new Error('unreachable: the Moon is always in BODIES');
  const bodies = options.bodies ?? defaultBodies();
  const positionOptions: PositionOptions | undefined =
    options.zodiac === undefined ? undefined : { zodiac: options.zodiac };

  const here = await provider.position(jd, moon.id, positionOptions);
  const signIndex = Math.floor(norm360(here.longitude) / 30);
  const signStart = signIndex * 30;
  const signEnd = norm360(signStart + 30);

  // The Moon is somewhere in `[signStart, signEnd)` now: searching forward from three days ago
  // finds its entry (it was still in an earlier sign then), and from now finds its exit.
  const signEntryJd = await provider.nextMoonCrossing(jd - MAX_SIGN_DAYS, signStart, options.zodiac);
  const signExitJd = await provider.nextMoonCrossing(jd, signEnd, options.zodiac);

  const events = await findMoonAspects(provider, moon.id, bodies, signEntryJd, signExitJd, positionOptions);
  return { signIndex, signEntryJd, signExitJd, events };
}

/** Whether the window's Moon is void at `jd`, which must lie inside `[signEntryJd, signExitJd)`. Pure. */
export function voidOfCourseAt(window: MoonSignWindow, jd: JulianDayUT): VoidOfCourseMoon {
  const lastAspect = [...window.events].reverse().find((event) => event.jd <= jd);
  const nextAspect = window.events.find((event) => event.jd > jd);
  const isVoid = nextAspect === undefined;
  return {
    jd,
    signIndex: window.signIndex,
    signEntryJd: window.signEntryJd,
    signExitJd: window.signExitJd,
    isVoid,
    lastAspect,
    nextAspect,
    voidFromJd: isVoid ? (lastAspect?.jd ?? window.signEntryJd) : undefined,
  };
}

/**
 * Whether the Moon is void of course at `jd`, with the surrounding aspects and sign entry/exit.
 * See the file doc for the convention.
 */
export async function findVoidOfCourseMoon(
  provider: EphemerisProvider,
  jd: JulianDayUT,
  options: VoidOfCourseOptions = {},
): Promise<VoidOfCourseMoon> {
  return voidOfCourseAt(await findMoonSignWindow(provider, jd, options), jd);
}
