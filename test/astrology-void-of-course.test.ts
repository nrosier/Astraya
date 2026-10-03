/**
 * Void-of-course Moon (#402), against the real Swiss Ephemeris. There is no published table to
 * assert against here, so the module is checked two ways: its structural promises (the void flag
 * and the next aspect always agree, the sign window is a plausible two to three days), and an
 * independent brute-force finder written differently — fixed two-minute sampling with no
 * bisection and no `nextMoonCrossing` — that has to find the same aspects within a few minutes.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { bodyByKey } from '../src/astrology/bodies.js';
import { findMoonSignWindow, findVoidOfCourseMoon, voidOfCourseAt } from '../src/astrology/void-of-course.js';
import type { BodyId, EphemerisProvider, JulianDayUT } from '../src/ephemeris/types.js';
import { getEngine } from './engine-harness.js';

let engine: EphemerisProvider;
let start: JulianDayUT;

const MOON = bodyByKey('moon')?.id ?? -1;
const SUN = bodyByKey('sun')?.id ?? -1;
const PLANET_KEYS = ['sun', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const PLANETS: readonly BodyId[] = PLANET_KEYS.map((key) => bodyByKey(key)?.id ?? -1);
const MAJOR_ANGLES = [0, 60, 90, 120, 180];

const MINUTE = 1 / 1440;

function norm360(x: number): number {
  return ((x % 360) + 360) % 360;
}

function signedDelta(from: number, to: number): number {
  const raw = norm360(to - from);
  return raw > 180 ? raw - 360 : raw;
}

/** Every exact Ptolemaic aspect of the Moon to `PLANETS` in `[from, to]`, found by plain two-minute sampling. */
async function bruteForceAspects(from: JulianDayUT, to: JulianDayUT): Promise<readonly number[]> {
  const times: number[] = [];
  let previous: Map<string, number> | undefined;
  for (let t = from; t <= to; t += 2 * MINUTE) {
    const [moon, ...others] = await engine.positions(t, [MOON, ...PLANETS]);
    const now = new Map<string, number>();
    others.forEach((planet, index) => {
      for (const angle of MAJOR_ANGLES) {
        for (const offset of angle === 0 || angle === 180 ? [angle] : [angle, -angle]) {
          now.set(
            `${String(index)}:${String(offset)}`,
            signedDelta(moon?.longitude ?? 0, norm360(planet.longitude + offset)),
          );
        }
      }
    });
    if (previous !== undefined) {
      for (const [key, value] of now) {
        const before = previous.get(key);
        if (before === undefined) continue;
        if (before > 0 !== value > 0 && Math.abs(before - value) < 180) times.push(t - MINUTE);
      }
    }
    previous = now;
  }
  return times.sort((a, b) => a - b);
}

beforeAll(async () => {
  engine = await getEngine();
  start = await engine.julianDayFromUtc(2024, 3, 1, 0, 0, 0);
}, 60_000);

describe('findVoidOfCourseMoon (#402)', () => {
  it('keeps its promises at many moments across a month: the void flag, the next aspect and the sign window all agree', async () => {
    for (let k = 0; k < 14; k++) {
      const jd = start + k * 2.3 + 0.17;
      const result = await findVoidOfCourseMoon(engine, jd);
      expect(result.isVoid).toBe(result.nextAspect === undefined);
      expect(result.signEntryJd).toBeLessThanOrEqual(jd);
      expect(result.signExitJd).toBeGreaterThan(jd);
      const days = result.signExitJd - result.signEntryJd;
      expect(days).toBeGreaterThan(1.9);
      expect(days).toBeLessThan(3.0);
      if (result.lastAspect) {
        expect(result.lastAspect.jd).toBeGreaterThanOrEqual(result.signEntryJd);
        expect(result.lastAspect.jd).toBeLessThanOrEqual(jd);
      }
      if (result.nextAspect) {
        expect(result.nextAspect.jd).toBeGreaterThan(jd);
        expect(result.nextAspect.jd).toBeLessThanOrEqual(result.signExitJd);
      }
      if (result.isVoid) {
        expect(result.voidFromJd).toBe(result.lastAspect?.jd ?? result.signEntryJd);
      } else {
        expect(result.voidFromJd).toBeUndefined();
      }
    }
  }, 120_000);

  it('agrees with an independent brute-force search about every aspect in one Moon sign, to within minutes', async () => {
    const jd = start + 5.4;
    const result = await findVoidOfCourseMoon(engine, jd);
    const brute = await bruteForceAspects(result.signEntryJd, result.signExitJd);

    // Re-derive the module's full aspect list for this sign by walking its answers forward.
    const found: number[] = [];
    if (result.lastAspect) found.push(result.lastAspect.jd);
    let cursor = result;
    let guard = 0;
    while (cursor.nextAspect && guard++ < 40) {
      found.push(cursor.nextAspect.jd);
      cursor = await findVoidOfCourseMoon(engine, cursor.nextAspect.jd + MINUTE / 2);
    }
    // The walk only covers aspects from `lastAspect` on; earlier ones are in `brute` too.
    const lastJd = result.lastAspect?.jd;
    const bruteFromLast = lastJd === undefined ? brute : brute.filter((t) => t >= lastJd - 4 * MINUTE);
    // Guards against two empty lists "agreeing": a Moon sign holds several aspects.
    expect(brute.length).toBeGreaterThanOrEqual(3);
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(found.length).toBe(bruteFromLast.length);
    found.forEach((t, index) => {
      expect(Math.abs(t - (bruteFromLast[index] ?? Number.NaN))).toBeLessThan(4 * MINUTE);
    });
  }, 300_000);

  it('is void exactly from the last aspect of a sign to its end: a moment just after it, and one just before the exit, both say void with the same boundaries', async () => {
    // Walk forward until a sign's final aspect is found, then probe either side of it.
    let jd = start;
    let probed = false;
    for (let k = 0; k < 12 && !probed; k++, jd += 2.4) {
      const here = await findVoidOfCourseMoon(engine, jd);
      let cursor = here;
      let last = here.nextAspect;
      let guard = 0;
      while (cursor.nextAspect && guard++ < 40) {
        last = cursor.nextAspect;
        cursor = await findVoidOfCourseMoon(engine, cursor.nextAspect.jd + MINUTE / 2);
      }
      if (!last) continue;
      const justAfter = await findVoidOfCourseMoon(engine, last.jd + 2 * MINUTE);
      const justBefore = await findVoidOfCourseMoon(engine, here.signExitJd - 2 * MINUTE);
      const justBeforeAspect = await findVoidOfCourseMoon(engine, last.jd - 2 * MINUTE);
      expect(justAfter.isVoid).toBe(true);
      expect(justBefore.isVoid).toBe(true);
      expect(justBeforeAspect.isVoid).toBe(false);
      expect(justAfter.voidFromJd).toBeCloseTo(last.jd, 4);
      expect(justBefore.voidFromJd).toBeCloseTo(last.jd, 4);
      expect(justAfter.signExitJd).toBeCloseTo(here.signExitJd, 4);
      probed = true;
    }
    expect(probed).toBe(true);
  }, 300_000);

  it('counts fewer aspects when fewer bodies are allowed, so can only be void more often', async () => {
    let sunOnlyVoid = 0;
    let defaultVoid = 0;
    for (let k = 0; k < 10; k++) {
      const jd = start + k * 2.9 + 0.3;
      const defaults = await findVoidOfCourseMoon(engine, jd);
      const sunOnly = await findVoidOfCourseMoon(engine, jd, { bodies: [SUN] });
      if (defaults.isVoid) defaultVoid++;
      if (sunOnly.isVoid) sunOnlyVoid++;
      if (defaults.isVoid) expect(sunOnly.isVoid).toBe(true);
    }
    expect(sunOnlyVoid).toBeGreaterThanOrEqual(defaultVoid);
  }, 300_000);

  it('works in the sidereal zodiac, with sign boundaries in sidereal longitude', async () => {
    const tropical = await findVoidOfCourseMoon(engine, start + 1);
    const sidereal = await findVoidOfCourseMoon(engine, start + 1, { zodiac: { kind: 'sidereal', ayanamsa: 1 } });
    expect(sidereal.signExitJd).toBeGreaterThan(start + 1);
    expect(sidereal.signEntryJd).toBeLessThanOrEqual(start + 1);
    // The ~24° ayanamsa moves the sign boundaries, so the exit moment cannot be the same.
    expect(Math.abs(sidereal.signExitJd - tropical.signExitJd)).toBeGreaterThan(0.2);
  }, 120_000);
});

describe('findMoonSignWindow and voidOfCourseAt (#409)', () => {
  it('answers exactly as findVoidOfCourseMoon does, for every moment inside one window', async () => {
    const jd = start + 5.4;
    const window = await findMoonSignWindow(engine, jd);
    // Sample from the window's start to just before its end.
    for (let step = 0; step <= 12; step++) {
      const at = window.signEntryJd + ((window.signExitJd - window.signEntryJd) * step) / 13 + 0.001;
      const viaWindow = voidOfCourseAt(window, at);
      const direct = await findVoidOfCourseMoon(engine, at);
      expect(viaWindow).toEqual(direct);
    }
  }, 300_000);

  it('is pure: it needs no ephemeris, only a window and a moment', () => {
    const window = {
      signIndex: 3,
      signEntryJd: 100,
      signExitJd: 102.5,
      events: [
        { jd: 100.5, body: 1, aspect: { key: 'trine', name: 'Trine', angle: 120, family: 'major' as const } },
        { jd: 101.2, body: 2, aspect: { key: 'square', name: 'Square', angle: 90, family: 'major' as const } },
      ],
    };
    expect(voidOfCourseAt(window, 100.1)).toMatchObject({ isVoid: false, lastAspect: undefined });
    expect(voidOfCourseAt(window, 100.1).nextAspect?.jd).toBe(100.5);
    expect(voidOfCourseAt(window, 100.9)).toMatchObject({ isVoid: false });
    const late = voidOfCourseAt(window, 101.8);
    expect(late.isVoid).toBe(true);
    expect(late.lastAspect?.jd).toBe(101.2);
    expect(late.voidFromJd).toBe(101.2);
    // With no aspects at all the Moon is void from the moment it enters the sign.
    const bare = voidOfCourseAt({ ...window, events: [] }, 101);
    expect(bare.isVoid).toBe(true);
    expect(bare.voidFromJd).toBe(100);
  });
});
