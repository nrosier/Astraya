/**
 * From a resolved birth moment to a Julian day, against the real engine.
 *
 * The resolver's offset only matters if it survives the conversion to the number
 * Swiss Ephemeris actually consumes. These tests exercise both paths — the
 * leap-second aware one for modern dates and the JD-space one for everything
 * earlier — and check the boundaries where an offset crosses midnight, a year end,
 * or the ten days the Gregorian reform deleted.
 */
import { describe, expect, it } from 'vitest';
import { julianDayFor } from '../src/time/julian.js';
import { resolveMoment } from '../src/time/resolve.js';
import type { CivilDateTime, Coordinates } from '../src/time/types.js';
import { getEngine } from './engine-harness.js';

/** One second of a day, the tolerance below which nothing astrological changes. */
const ONE_SECOND_JD = 1 / 86_400;

const LONDON: Coordinates = { latitude: 51.5074, longitude: -0.1278 };
const NEW_YORK: Coordinates = { latitude: 40.7128, longitude: -74.006 };

function civil(y: number, mo: number, d: number, h: number, mi = 0, s = 0): CivilDateTime {
  return { year: y, month: mo, day: d, hour: h, minute: mi, second: s };
}

describe('julianDayFor', () => {
  it('agrees with swe_julday on a UTC birth, where the offset is zero', async () => {
    const engine = await getEngine();
    const moment = resolveMoment({
      civil: civil(2000, 1, 1, 12),
      coordinates: LONDON,
      offsetOverrideMinutes: 0,
    });
    const jd = await julianDayFor(engine, moment);
    // J2000.0 is JD 2451545.0 by definition — an external check, not a snapshot of
    // our own output.
    expect(jd).toBeCloseTo(2451545.0, 4);
    expect(await engine.julianDay(2000, 1, 1, 12)).toBeCloseTo(jd, 4);
  });

  it('subtracts an eastern offset and adds a western one', async () => {
    const engine = await getEngine();
    const base = await julianDayFor(
      engine,
      resolveMoment({ civil: civil(1990, 6, 15, 12), coordinates: LONDON, offsetOverrideMinutes: 0 }),
    );
    const east = await julianDayFor(
      engine,
      resolveMoment({ civil: civil(1990, 6, 15, 12), coordinates: LONDON, offsetOverrideMinutes: 120 }),
    );
    const west = await julianDayFor(
      engine,
      resolveMoment({ civil: civil(1990, 6, 15, 12), coordinates: LONDON, offsetOverrideMinutes: -300 }),
    );
    // Noon at +02:00 is 10:00 UTC: two hours *earlier* on the timeline.
    expect((base - east) * 24).toBeCloseTo(2, 6);
    expect((west - base) * 24).toBeCloseTo(5, 6);
  });

  it('carries an offset across midnight into the previous day', async () => {
    const engine = await getEngine();
    // 00:30 local at -05:00 is 05:30 UTC the same day; 23:30 local at +02:00 is
    // 21:30 UTC. The interesting one is 00:30 at +02:00, which is the day before.
    const jd = await julianDayFor(
      engine,
      resolveMoment({ civil: civil(1990, 6, 15, 0, 30), coordinates: LONDON, offsetOverrideMinutes: 120 }),
    );
    const expected = await engine.julianDay(1990, 6, 14, 22.5);
    // Within a second, not identical: this date takes the leap-second aware path
    // while `expected` is the naive one, and the gap between them is UT1 minus UTC
    // (measured: 0.020 s here, 0.672 s just before the 1989 leap second). A wrong
    // rollover would be out by an hour or a day, never by milliseconds.
    expect(Math.abs(jd - expected)).toBeLessThan(ONE_SECOND_JD);
  });

  it('carries an offset across a year boundary', async () => {
    const engine = await getEngine();
    const jd = await julianDayFor(
      engine,
      resolveMoment({ civil: civil(1990, 1, 1, 1, 0), coordinates: LONDON, offsetOverrideMinutes: 120 }),
    );
    const expected = await engine.julianDay(1989, 12, 31, 23);
    expect(Math.abs(jd - expected)).toBeLessThan(ONE_SECOND_JD);
  });

  it('reads a pre-reform date in the Julian calendar', async () => {
    const engine = await getEngine();
    const moment = resolveMoment({
      civil: civil(1500, 6, 15, 12),
      coordinates: LONDON,
      offsetOverrideMinutes: 0,
    });
    expect(moment.calendar).toBe('julian');
    const jd = await julianDayFor(engine, moment);
    // Measured against the engine, not recalled: the Julian and Gregorian readings
    // of a 1500 date are ten days apart (nine applies to the 1400s, eight to the
    // 1300s). If the calendar flag were ignored the difference would vanish
    // entirely — which is exactly the silent failure this test exists to catch.
    const asGregorian = await engine.julianDay(1500, 6, 15, 12, 'gregorian');
    expect(jd - asGregorian).toBeCloseTo(10, 6);
  });

  it('treats the reform gap as the continuous instant it was', async () => {
    const engine = await getEngine();
    // 4 October 1582 (Julian) was immediately followed by 15 October (Gregorian).
    // Consecutive days, despite the ten-day jump in what was written down.
    const last = await julianDayFor(
      engine,
      resolveMoment({ civil: civil(1582, 10, 4, 12), coordinates: LONDON, offsetOverrideMinutes: 0 }),
    );
    const first = await julianDayFor(
      engine,
      resolveMoment({ civil: civil(1582, 10, 15, 12), coordinates: LONDON, offsetOverrideMinutes: 0 }),
    );
    expect(first - last).toBeCloseTo(1, 6);
  });

  it('uses the leap-second aware path for modern dates and agrees with the naive one to under a second', async () => {
    const engine = await getEngine();
    const moment = resolveMoment({
      civil: civil(2015, 6, 30, 23, 59, 59),
      coordinates: LONDON,
      offsetOverrideMinutes: 0,
    });
    const jd = await julianDayFor(engine, moment);
    const naive = await engine.julianDay(2015, 6, 30, 23 + 59 / 60 + 59 / 3600);
    // They must not be wildly apart, and they need not be identical: the difference
    // is UT1 minus UTC, under a second, which is the whole point of the other path.
    expect(Math.abs(jd - naive)).toBeLessThan(2 * ONE_SECOND_JD);
  });

  it('turns a one-hour offset error into a chart-changing shift', async () => {
    const engine = await getEngine();
    // The failure this milestone exists to prevent, measured end to end: a one-hour
    // offset mistake is a different rising sign, and the chart looks fine.
    const correct = resolveMoment({
      civil: civil(1960, 6, 15, 14, 30),
      coordinates: NEW_YORK,
      offsetOverrideMinutes: -300,
    });
    const wrong = resolveMoment({
      civil: civil(1960, 6, 15, 14, 30),
      coordinates: NEW_YORK,
      offsetOverrideMinutes: -240,
    });
    const place = { latitude: NEW_YORK.latitude, longitude: NEW_YORK.longitude, altitude: 0 };
    const a = await engine.houses(await julianDayFor(engine, correct), place, 'P');
    const b = await engine.houses(await julianDayFor(engine, wrong), place, 'P');
    const arc = (x: number, y: number): number => Math.abs(((x - y + 540) % 360) - 180);

    // ARMC is the quantity that actually advances uniformly — one hour of time is
    // 15.04 degrees of right ascension, always. Pinned tightly because any drift
    // here would mean the time arithmetic itself is wrong.
    expect(arc(a.armc, b.armc)).toBeCloseTo(15.04, 1);

    // The Ascendant's ecliptic longitude does *not* move uniformly: the rate
    // depends on latitude, obliquity and which sign is rising, so the familiar
    // "15 degrees per hour" is only an average. Measured here: 11.86 degrees, and
    // the MC 14.21. The assertion is therefore that the error is large enough to
    // rewrite the chart, not that it equals any particular figure.
    const ascDrift = arc(a.ascendant, b.ascendant);
    expect(ascDrift).toBeGreaterThan(10);
    expect(ascDrift).toBeLessThan(20);

    // Every house cusp moves, which is what makes this fatal rather than cosmetic.
    for (let house = 1; house <= 12; house += 1) {
      expect(arc(a.cusps[house] ?? 0, b.cusps[house] ?? 0)).toBeGreaterThan(5);
    }
  });
});
