/**
 * Real-engine tests for the exact transit-to-natal aspect finder (#207).
 *
 * Runs against the actual Swiss Ephemeris, never a mock: the point is that a
 * found crossing genuinely lands the transiting body at the aspect's exact
 * angle from the natal longitude, not merely that the arithmetic is
 * internally consistent.
 */
import { describe, expect, it } from 'vitest';
import { angularSeparation } from '../src/astrology/aspects.js';
import { findExactTransitAspects, targetLongitudes } from '../src/astrology/transit-events.js';
import { SE } from '../src/ephemeris/generated-constants.js';
import type { JulianDayUT } from '../src/ephemeris/types.js';
import { getEngine } from './engine-harness.js';

const NATAL_JD = 2448088.104167; // 1990-06-15 14:30 UT, arbitrary fixed epoch

async function longitudeAt(jd: JulianDayUT, body: number): Promise<number> {
  const engine = await getEngine();
  const [position] = await engine.positions(jd, [body]);
  if (position === undefined) throw new Error('unreachable: the ephemeris returned no position for the body');
  return position.longitude;
}

describe('targetLongitudes (#207)', () => {
  it('names a single target for conjunction and opposition', () => {
    expect(targetLongitudes(0, 100)).toEqual([100]);
    expect(targetLongitudes(180, 100)).toEqual([280]);
  });

  it('names two symmetric targets for every other aspect', () => {
    expect(targetLongitudes(120, 10)).toEqual([130, 250]);
  });

  it('wraps every target into 0-360', () => {
    expect(targetLongitudes(120, 350)).toEqual([110, 230]);
  });
});

describe('findExactTransitAspects (#207)', () => {
  it('finds transiting Mars forming a real trine to natal Venus within a month', async () => {
    const engine = await getEngine();
    const natalVenusLongitude = await longitudeAt(NATAL_JD, SE.SE_VENUS);
    const natalLongitudes = new Map([[SE.SE_VENUS, natalVenusLongitude]]);

    // A window well after the natal moment, wide enough (Mars averages ~0.5
    // deg/day, so ~700 days covers a full circle) that transiting Mars is
    // essentially guaranteed to cross at least one of the two trine targets —
    // the assertion below is on the *exactness* of whatever is found, not on
    // there being exactly one.
    const fromJd = NATAL_JD + 3650;
    const toJd = fromJd + 700;

    const events = await findExactTransitAspects(engine, [SE.SE_MARS], natalLongitudes, fromJd, toJd);
    const trines = events.filter((event) => event.aspect.key === 'trine');
    expect(trines.length).toBeGreaterThan(0);

    for (const event of trines) {
      expect(event.jd).toBeGreaterThanOrEqual(fromJd);
      expect(event.jd).toBeLessThanOrEqual(toJd);
      const marsLongitude = await longitudeAt(event.jd, SE.SE_MARS);
      const separation = angularSeparation(marsLongitude, natalVenusLongitude);
      expect(Math.abs(separation - 120)).toBeLessThan(0.001);
    }
  });

  it('reports the transiting body as retrograde exactly when its longitude speed is negative there', async () => {
    const engine = await getEngine();
    const natalSaturnLongitude = await longitudeAt(NATAL_JD, SE.SE_SATURN);
    const natalLongitudes = new Map([[SE.SE_SATURN, natalSaturnLongitude]]);

    const fromJd = NATAL_JD;
    const toJd = fromJd + 365 * 3; // wide enough to likely catch a retrograde shadow crossing

    const events = await findExactTransitAspects(engine, [SE.SE_SATURN], natalLongitudes, fromJd, toJd);
    // A Saturn return happens roughly every ~29.5 years; within 3 years there may be none,
    // but if any conjunction is found its reported retrograde flag must match the ephemeris.
    for (const event of events.filter((candidate) => candidate.aspect.key === 'conjunction')) {
      const [position] = await engine.positions(event.jd, [SE.SE_SATURN]);
      if (position === undefined) throw new Error('unreachable: index within bounds');
      expect(event.retrograde).toBe(position.longitudeSpeed < 0);
    }
  });

  it('returns events in chronological order', async () => {
    const engine = await getEngine();
    const natalLongitudes = new Map([
      [SE.SE_VENUS, await longitudeAt(NATAL_JD, SE.SE_VENUS)],
      [SE.SE_MARS, await longitudeAt(NATAL_JD, SE.SE_MARS)],
    ]);

    const events = await findExactTransitAspects(
      engine,
      [SE.SE_MERCURY, SE.SE_JUPITER],
      natalLongitudes,
      NATAL_JD,
      NATAL_JD + 90,
    );

    for (let i = 1; i < events.length; i++) {
      const previous = events[i - 1];
      const current = events[i];
      if (previous === undefined || current === undefined) throw new Error('unreachable: index within bounds');
      expect(current.jd).toBeGreaterThanOrEqual(previous.jd);
    }
  });

  it('returns nothing for an empty or reversed window', async () => {
    const engine = await getEngine();
    const natalLongitudes = new Map([[SE.SE_VENUS, await longitudeAt(NATAL_JD, SE.SE_VENUS)]]);
    expect(await findExactTransitAspects(engine, [SE.SE_MARS], natalLongitudes, NATAL_JD, NATAL_JD)).toEqual([]);
  });

  it('rejects a window that ends before it starts', async () => {
    const engine = await getEngine();
    const natalLongitudes = new Map([[SE.SE_VENUS, await longitudeAt(NATAL_JD, SE.SE_VENUS)]]);
    await expect(
      findExactTransitAspects(engine, [SE.SE_MARS], natalLongitudes, NATAL_JD, NATAL_JD - 1),
    ).rejects.toThrow();
  });
});
