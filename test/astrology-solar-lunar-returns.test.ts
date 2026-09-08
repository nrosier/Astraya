/**
 * Real-engine tests for solar and lunar return finding (#49).
 *
 * Runs against the actual Swiss Ephemeris crossing root-finders
 * (`nextSunCrossing`/`nextMoonCrossing`), never a mock: the point of this
 * module is that the found Julian days are genuine ephemeris crossings.
 */
import { describe, expect, it } from 'vitest';
import { lunarReturnsInPeriod, solarReturnInYear } from '../src/astrology/solar-lunar-returns.js';
import { SE } from '../src/ephemeris/generated-constants.js';
import type { JulianDayUT } from '../src/ephemeris/types.js';
import { arcsecondsBetween, getEngine } from './engine-harness.js';

const NATAL_JD = 2448088.104167; // 1990-06-15 14:30 UT, arbitrary fixed epoch

async function sunLongitudeAt(jd: JulianDayUT): Promise<number> {
  const engine = await getEngine();
  const [position] = await engine.positions(jd, [SE.SE_SUN]);
  if (position === undefined) throw new Error('unreachable: the ephemeris returned no position for the Sun');
  return position.longitude;
}

async function moonLongitudeAt(jd: JulianDayUT): Promise<number> {
  const engine = await getEngine();
  const [position] = await engine.positions(jd, [SE.SE_MOON]);
  if (position === undefined) throw new Error('unreachable: the ephemeris returned no position for the Moon');
  return position.longitude;
}

describe('solarReturnInYear (#49)', () => {
  it('finds a Sun crossing within the given year matching the natal longitude', async () => {
    const engine = await getEngine();
    const natalLongitude = await sunLongitudeAt(NATAL_JD);

    const returnJd = await solarReturnInYear(engine, natalLongitude, 2000);
    const returnLongitude = await sunLongitudeAt(returnJd);

    expect(arcsecondsBetween(returnLongitude, natalLongitude)).toBeLessThan(0.01);

    const startOfYear = await engine.julianDay(2000, 1, 1, 0);
    const startOfNextYear = await engine.julianDay(2001, 1, 1, 0);
    expect(returnJd).toBeGreaterThanOrEqual(startOfYear);
    expect(returnJd).toBeLessThan(startOfNextYear);
  });

  it('lands close to the calendar-date anniversary of birth', async () => {
    const engine = await getEngine();
    const natalLongitude = await sunLongitudeAt(NATAL_JD);

    const returnJd = await solarReturnInYear(engine, natalLongitude, 2010);
    // 2010-06-15, roughly: natal day-of-year plus 20 tropical years.
    const anniversaryJd = NATAL_JD + 365.2425 * 20;
    expect(Math.abs(returnJd - anniversaryJd)).toBeLessThan(1.5);
  });
});

describe('lunarReturnsInPeriod (#49)', () => {
  it('finds the expected number of returns spaced ~27.3 days apart', async () => {
    const engine = await getEngine();
    const natalLongitude = await moonLongitudeAt(NATAL_JD);

    const periodStart = NATAL_JD + 365.2425 * 10;
    const periodEnd = periodStart + 365.2425; // roughly one year later

    const returns = await lunarReturnsInPeriod(engine, natalLongitude, periodStart, periodEnd);

    expect(returns.length).toBeGreaterThanOrEqual(12);
    expect(returns.length).toBeLessThanOrEqual(14);
    for (const jd of returns) {
      expect(jd).toBeGreaterThanOrEqual(periodStart);
      expect(jd).toBeLessThanOrEqual(periodEnd);
    }
    for (let i = 1; i < returns.length; i++) {
      const previous = returns[i - 1];
      const current = returns[i];
      if (previous === undefined || current === undefined) throw new Error('unreachable: index within bounds');
      const gap = current - previous;
      expect(gap).toBeGreaterThan(25);
      expect(gap).toBeLessThan(30);
    }
  });

  it('each returned crossing genuinely matches the natal Moon longitude', async () => {
    const engine = await getEngine();
    const natalLongitude = await moonLongitudeAt(NATAL_JD);

    const periodStart = NATAL_JD;
    const periodEnd = periodStart + 90;
    const returns = await lunarReturnsInPeriod(engine, natalLongitude, periodStart, periodEnd);

    for (const jd of returns) {
      const longitude = await moonLongitudeAt(jd);
      expect(arcsecondsBetween(longitude, natalLongitude)).toBeLessThan(0.01);
    }
  });

  it('returns nothing for an empty or reversed period', async () => {
    const engine = await getEngine();
    const natalLongitude = await moonLongitudeAt(NATAL_JD);

    expect(await lunarReturnsInPeriod(engine, natalLongitude, NATAL_JD, NATAL_JD - 1)).toEqual([]);
  });
});
