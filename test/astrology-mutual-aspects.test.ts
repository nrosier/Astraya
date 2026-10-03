/**
 * Exact aspects between two moving bodies (#410), against the real Swiss Ephemeris. Ground
 * truth is public history: Jupiter and Saturn were conjunct in a triple in 1980-81, then in May
 * 2000, December 2020 and October 2040; and Venus's successive inferior conjunctions with the
 * Sun are ~144° apart (five synodic periods = eight years), which is what draws the pentagram.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { angularSeparation } from '../src/astrology/aspects.js';
import { bodyByKey } from '../src/astrology/bodies.js';
import { defaultSampleStepDays, findMutualAspects, MAX_MUTUAL_SAMPLES } from '../src/astrology/mutual-aspects.js';
import type { EphemerisProvider, JulianDayUT } from '../src/ephemeris/types.js';
import { civilFromJulianDay } from '../src/time/julian.js';
import { getEngine } from './engine-harness.js';

let engine: EphemerisProvider;

const id = (key: string): number => bodyByKey(key)?.id ?? -1;
const JUPITER = id('jupiter');
const SATURN = id('saturn');
const VENUS = id('venus');
const SUN = id('sun');

beforeAll(async () => {
  engine = await getEngine();
}, 60_000);

async function jd(year: number, month: number, day: number): Promise<JulianDayUT> {
  return engine.julianDayFromUtc(year, month, day, 0, 0, 0);
}

function ymd(value: JulianDayUT): string {
  const c = civilFromJulianDay(value);
  return `${String(c.year)}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
}

describe('findMutualAspects (#410)', () => {
  it('finds the Jupiter-Saturn conjunctions of 1980-2050 — the 1981 triple, then 2000, 2020 and 2040', async () => {
    const events = await findMutualAspects(engine, JUPITER, SATURN, await jd(1980, 1, 1), await jd(2050, 1, 1), {
      bodyKeys: ['jupiter', 'saturn'],
    });
    expect(events.map((event) => ymd(event.jd).slice(0, 7))).toEqual([
      '1980-12',
      '1981-03',
      '1981-07',
      '2000-05',
      '2020-12',
      '2040-10',
    ]);
  }, 120_000);

  it('places each found conjunction where the two bodies really are together, to well under an arcsecond', async () => {
    const events = await findMutualAspects(engine, JUPITER, SATURN, await jd(2019, 1, 1), await jd(2022, 1, 1), {
      bodyKeys: ['jupiter', 'saturn'],
    });
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(ymd(event?.jd ?? 0)).toBe('2020-12-21');
    // Independent of the module: look the two bodies up again at the reported moment.
    const [a, b] = await engine.positions(event?.jd ?? 0, [JUPITER, SATURN]);
    expect(angularSeparation(a?.longitude ?? 0, b?.longitude ?? 90)).toBeLessThan(0.0002);
    // The great conjunction of 21 December 2020 fell at the start of Aquarius, about 0°29'.
    expect((event?.longitudeA ?? 0) % 30).toBeGreaterThan(0.3);
    expect((event?.longitudeA ?? 0) % 30).toBeLessThan(0.7);
    expect(Math.floor((event?.longitudeA ?? 0) / 30)).toBe(10);
  }, 60_000);

  it('flags retrograde motion at the moment of the aspect, which separates the 1981 triple', async () => {
    const events = await findMutualAspects(engine, JUPITER, SATURN, await jd(1980, 1, 1), await jd(1982, 1, 1), {
      bodyKeys: ['jupiter', 'saturn'],
    });
    expect(events).toHaveLength(3);
    // Direct, retrograde, direct — the shape of a triple conjunction.
    expect(events.map((event) => event.retrogradeA)).toEqual([false, true, false]);
  }, 60_000);

  it('finds the real Venus inferior conjunctions with the Sun, 2020-2026 — Venus retrograde at each', async () => {
    const events = await findMutualAspects(engine, VENUS, SUN, await jd(2020, 1, 1), await jd(2027, 1, 1), {
      bodyKeys: ['venus', 'sun'],
    });
    const inferior = events.filter((event) => event.retrogradeA);
    expect(inferior.map((event) => ymd(event.jd))).toEqual([
      '2020-06-03',
      '2022-01-09',
      '2023-08-13',
      '2025-03-23',
      '2026-10-24',
    ]);
  }, 120_000);

  it('draws the Venus pentagram: each inferior conjunction ~144° behind the last, and the sixth closing the star', async () => {
    const events = await findMutualAspects(engine, VENUS, SUN, await jd(2020, 1, 1), await jd(2028, 7, 1), {
      bodyKeys: ['venus', 'sun'],
    });
    const inferior = events.filter((event) => event.retrogradeA);
    expect(inferior).toHaveLength(6);
    for (let i = 1; i < inferior.length; i++) {
      const previous = inferior[i - 1];
      const current = inferior[i];
      const step = ((((current?.longitudeA ?? 0) - (previous?.longitudeA ?? 0)) % 360) + 360) % 360;
      // Five synodic periods are eight years, so each point sits 215.6° (= -144.4°) from the last.
      // The Sun's uneven apparent speed moves any single step by up to ~8° either way.
      expect(Math.abs(step - 215.6)).toBeLessThan(10);
    }
    const first = inferior[0];
    const sixth = inferior[5];
    expect(angularSeparation(first?.longitudeA ?? 0, sixth?.longitudeA ?? 180)).toBeLessThan(4);
  }, 120_000);

  it('finds both relative positions of a non-conjunction aspect: A ahead of B and A behind it', async () => {
    const events = await findMutualAspects(engine, JUPITER, SATURN, await jd(2019, 1, 1), await jd(2031, 1, 1), {
      aspectKeys: ['square'],
      bodyKeys: ['jupiter', 'saturn'],
    });
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const event of events) {
      expect(event.aspect.key).toBe('square');
      expect(angularSeparation(event.longitudeA, event.longitudeB)).toBeCloseTo(90, 2);
    }
    const ahead = events.some((event) => (((event.longitudeA - event.longitudeB) % 360) + 360) % 360 < 180);
    const behind = events.some((event) => (((event.longitudeA - event.longitudeB) % 360) + 360) % 360 > 180);
    expect(ahead || behind).toBe(true);
  }, 120_000);

  it('returns events in chronological order across several aspect kinds', async () => {
    const events = await findMutualAspects(engine, JUPITER, SATURN, await jd(1990, 1, 1), await jd(2010, 1, 1), {
      aspectKeys: ['conjunction', 'trine', 'opposition'],
      bodyKeys: ['jupiter', 'saturn'],
    });
    expect(events.length).toBeGreaterThan(1);
    const times = events.map((event) => event.jd);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(events.map((event) => event.aspect.key)).size).toBeGreaterThan(1);
  }, 120_000);

  it('works in the sidereal zodiac without moving when the aspect happens', async () => {
    const tropical = await findMutualAspects(engine, JUPITER, SATURN, await jd(2019, 1, 1), await jd(2022, 1, 1), {
      bodyKeys: ['jupiter', 'saturn'],
    });
    const sidereal = await findMutualAspects(engine, JUPITER, SATURN, await jd(2019, 1, 1), await jd(2022, 1, 1), {
      bodyKeys: ['jupiter', 'saturn'],
      zodiac: { kind: 'sidereal', ayanamsa: 1 },
    });
    // An aspect is a relative position, so the zodiac cannot change *when* — only the longitude it is quoted at.
    expect(Math.abs((sidereal[0]?.jd ?? 0) - (tropical[0]?.jd ?? 5))).toBeLessThan(0.01);
    expect(Math.abs((sidereal[0]?.longitudeA ?? 0) - (tropical[0]?.longitudeA ?? 0))).toBeGreaterThan(20);
  }, 60_000);

  it('picks a sample step from the faster body, and a coarse one for slow outer pairs', () => {
    expect(defaultSampleStepDays(['venus', 'sun'])).toBe(1);
    expect(defaultSampleStepDays(['mercury', 'saturn'])).toBe(0.5);
    expect(defaultSampleStepDays(['uranus', 'pluto'])).toBe(15);
    expect(defaultSampleStepDays(['moon', 'pluto'])).toBeCloseTo(1 / 24, 9);
    expect(defaultSampleStepDays()).toBe(2);
    expect(defaultSampleStepDays(['unknown', 'saturn'])).toBe(2);
  });

  it('refuses a range that would need more samples than a browser tab can reasonably fetch', async () => {
    await expect(
      findMutualAspects(engine, VENUS, SUN, await jd(1900, 1, 1), await jd(2100, 1, 1), {
        sampleStepDays: 200 / MAX_MUTUAL_SAMPLES,
      }),
    ).rejects.toThrow(RangeError);
  });

  it('rejects a reversed range and a body paired with itself', async () => {
    await expect(findMutualAspects(engine, VENUS, SUN, 2460000, 2459000)).rejects.toThrow(/before/);
    await expect(findMutualAspects(engine, VENUS, VENUS, 2459000, 2460000)).rejects.toThrow(/itself/);
  });
});
