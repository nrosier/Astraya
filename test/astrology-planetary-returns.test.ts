/**
 * Real-engine tests for planetary returns and demibirthday (#50).
 *
 * Runs against the actual Swiss Ephemeris engine, never a mock: the whole
 * point of the generic crossing search is that it agrees with the exact
 * Sun/Moon root-finders where both apply, and finds a genuine crossing for
 * bodies that have no dedicated root-finder at all.
 */
import { describe, expect, it } from 'vitest';
import {
  demibirthdayInYear,
  nextBodyCrossing,
  nextReturnOfBody,
  progressedLunarReturnOnOrBefore,
  progressedMoonLongitude,
} from '../src/astrology/planetary-returns.js';
import { SYNODIC_MONTH_DAYS } from '../src/astrology/minor-progressions.js';
import { SE } from '../src/ephemeris/generated-constants.js';
import type { JulianDayUT } from '../src/ephemeris/types.js';
import { arcsecondsBetween, getEngine } from './engine-harness.js';

const NATAL_JD = 2448088.104167; // 1990-06-15 14:30 UT, arbitrary fixed epoch

async function longitudeAt(jd: JulianDayUT, body: number): Promise<number> {
  const engine = await getEngine();
  const [position] = await engine.positions(jd, [body]);
  if (position === undefined) throw new Error(`unreachable: no position returned for body ${body}`);
  return position.longitude;
}

describe('nextBodyCrossing (#50)', () => {
  it('finds a genuine crossing for a body with no dedicated root-finder', async () => {
    const engine = await getEngine();
    const natalLongitude = await longitudeAt(NATAL_JD, SE.SE_MARS);

    const crossingJd = await nextBodyCrossing(engine, SE.SE_MARS, natalLongitude, NATAL_JD + 1);
    const crossingLongitude = await longitudeAt(crossingJd, SE.SE_MARS);

    expect(arcsecondsBetween(crossingLongitude, natalLongitude)).toBeLessThan(1);
    expect(crossingJd).toBeGreaterThan(NATAL_JD);
  });

  it('agrees with the exact Sun root-finder for the Sun itself', async () => {
    const engine = await getEngine();
    const natalLongitude = await longitudeAt(NATAL_JD, SE.SE_SUN);

    const generic = await nextBodyCrossing(engine, SE.SE_SUN, natalLongitude, NATAL_JD + 1, { stepDays: 30 });
    const exact = await engine.nextSunCrossing(NATAL_JD + 1, natalLongitude);

    expect(Math.abs(generic - exact)).toBeLessThan(1e-4);
  });
});

describe('nextReturnOfBody (#50)', () => {
  it('dispatches to the exact root-finder for the Sun and Moon', async () => {
    const engine = await getEngine();
    const sunLongitude = await longitudeAt(NATAL_JD, SE.SE_SUN);
    const moonLongitude = await longitudeAt(NATAL_JD, SE.SE_MOON);

    expect(await nextReturnOfBody(engine, SE.SE_SUN, sunLongitude, NATAL_JD + 1)).toBe(
      await engine.nextSunCrossing(NATAL_JD + 1, sunLongitude),
    );
    expect(await nextReturnOfBody(engine, SE.SE_MOON, moonLongitude, NATAL_JD + 1)).toBe(
      await engine.nextMoonCrossing(NATAL_JD + 1, moonLongitude),
    );
  });

  it('finds a return for a slow-moving outer planet via the generic search', async () => {
    const engine = await getEngine();
    const jupiterLongitude = await longitudeAt(NATAL_JD, SE.SE_JUPITER);

    const returnJd = await nextReturnOfBody(engine, SE.SE_JUPITER, jupiterLongitude, NATAL_JD + 1);
    const returnLongitude = await longitudeAt(returnJd, SE.SE_JUPITER);

    expect(arcsecondsBetween(returnLongitude, jupiterLongitude)).toBeLessThan(1);
    // A Jupiter return is roughly 12 years out, never within the first year.
    expect(returnJd - NATAL_JD).toBeGreaterThan(365);
  });
});

describe('demibirthdayInYear (#50)', () => {
  it('finds the Sun at the point exactly opposite its natal longitude', async () => {
    const engine = await getEngine();
    const natalLongitude = await longitudeAt(NATAL_JD, SE.SE_SUN);

    const demibirthdayJd = await demibirthdayInYear(engine, natalLongitude, 2000);
    const demibirthdayLongitude = await longitudeAt(demibirthdayJd, SE.SE_SUN);

    expect(arcsecondsBetween(demibirthdayLongitude, (natalLongitude + 180) % 360)).toBeLessThan(0.01);
  });

  it('falls within the given calendar year', async () => {
    const engine = await getEngine();
    const natalLongitude = await longitudeAt(NATAL_JD, SE.SE_SUN);

    const demibirthdayJd = await demibirthdayInYear(engine, natalLongitude, 2005);
    const startOfYear = await engine.julianDay(2005, 1, 1, 0);
    const startOfNextYear = await engine.julianDay(2006, 1, 1, 0);

    expect(demibirthdayJd).toBeGreaterThanOrEqual(startOfYear);
    expect(demibirthdayJd).toBeLessThan(startOfNextYear);
  });

  it('falls roughly half a year after the demibirthday of the previous year', async () => {
    const engine = await getEngine();
    const natalLongitude = await longitudeAt(NATAL_JD, SE.SE_SUN);

    const first = await demibirthdayInYear(engine, natalLongitude, 2010);
    const second = await demibirthdayInYear(engine, natalLongitude, 2011);

    expect(second - first).toBeCloseTo(365.2425, 0);
  });
});

describe('progressedMoonLongitude and progressedLunarReturnOnOrBefore (#50)', () => {
  it('finds a real Moon crossing of the progressed Moon longitude at or before the target date', async () => {
    const engine = await getEngine();
    const targetJd = NATAL_JD + 365.2425 * 20;

    const progressedLongitude = await progressedMoonLongitude(engine, NATAL_JD, targetJd);
    const returnJd = await progressedLunarReturnOnOrBefore(engine, progressedLongitude, targetJd);
    const returnLongitude = await longitudeAt(returnJd, SE.SE_MOON);

    expect(arcsecondsBetween(returnLongitude, progressedLongitude)).toBeLessThan(0.01);
    expect(returnJd).toBeLessThanOrEqual(targetJd);
    expect(targetJd - returnJd).toBeLessThan(SYNODIC_MONTH_DAYS);
  });
});
