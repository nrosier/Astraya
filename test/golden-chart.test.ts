/**
 * THE GATE (#8).
 *
 * If the ephemeris boundary is wrong, every feature built on top of it is wrong
 * invisibly — an astrological chart has no obviously-broken state, it just quietly
 * describes the wrong person. So this suite runs before any feature work and
 * compares against values Astraea did not produce.
 *
 * Reference values come from NASA/JPL Horizons via
 * `scripts/fetch-horizons-fixture.mjs`, committed under test/fixtures. They are
 * never written by hand: a plausible-looking wrong number would make this gate
 * certify a broken engine, which is worse than having no gate.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { arcsecondsBetween, getEngine } from './engine-harness.js';

interface Fixture {
  epochs: Record<string, { utc: [number, number, number, number, number, number]; horizons: string }>;
  positions: Record<string, Record<string, { se: number; longitude: number; latitude: number }>>;
}

/**
 * `JSON.parse` returns `any`, which would let the fixture's shape drift away from
 * `Fixture` without a word from the compiler — in a file whose entire job is to
 * detect drift. Narrowing through `unknown` forces the assertion to be deliberate.
 */
function loadFixture(path: string): Fixture {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('epochs' in parsed) || !('positions' in parsed)) {
    throw new Error(`Reference fixture at ${path} is missing 'epochs' or 'positions'.`);
  }
  return parsed as Fixture;
}

const fixture = loadFixture(resolve(import.meta.dirname, 'fixtures/horizons-positions.json'));

/**
 * Tolerances, set from measured agreement rather than aspiration.
 *
 * Two distinct sources of disagreement were measured, and they behave differently:
 *
 * 1. A constant offset of about 0.05" at every epoch, independent of how fast the
 *    body moves. That is a frame-level model difference between the two systems
 *    (nutation and aberration treatment), not a time error.
 *
 * 2. For dates in the future, an additional shared time offset of roughly 1.5
 *    seconds across Sun, Mercury, Venus, Mars and Moon. That is predicted delta-T:
 *    beyond the observed record the two systems extrapolate Earth's rotation
 *    differently. It is only visible on the Moon, which at about 0.55" per second
 *    of time turns 1.5 s into 0.83" — every slower body stays inside the 0.05"
 *    baseline.
 *
 * Hence two tolerances. A blanket 1" would have been indefensible: it would hide a
 * tenfold regression on historical dates, which is precisely the case that matters
 * because natal charts are always in the past.
 */
const TOLERANCE_ARCSEC = {
  /** Dates within the observed delta-T record. The demanding case. */
  historical: 0.2,
  /** Future dates, where predicted delta-T dominates for fast bodies. */
  future: 1.5,
} as const;

/** Epochs after this year depend on predicted rather than observed delta-T. */
const LAST_OBSERVED_DELTA_T_YEAR = 2025;

function toleranceFor(epochYear: number): number {
  return epochYear > LAST_OBSERVED_DELTA_T_YEAR ? TOLERANCE_ARCSEC.future : TOLERANCE_ARCSEC.historical;
}

describe('golden chart: planetary longitudes match JPL Horizons', () => {
  for (const [epochId, epoch] of Object.entries(fixture.epochs)) {
    describe(`${epochId} (${epoch.horizons} UT)`, () => {
      const bodies = fixture.positions[epochId];
      if (!bodies) throw new Error(`fixture has no positions for epoch ${epochId}`);

      const tolerance = toleranceFor(epoch.utc[0]);

      for (const [name, reference] of Object.entries(bodies)) {
        it(`${name} longitude within ${tolerance}"`, async () => {
          const engine = await getEngine();
          const [year, month, day, hour, minute, second] = epoch.utc;
          const jd = await engine.julianDayFromUtc(year, month, day, hour, minute, second);
          const actual = await engine.position(jd, reference.se);

          const error = arcsecondsBetween(actual.longitude, reference.longitude);
          expect(
            error,
            `${name} at ${epoch.horizons}: expected ${reference.longitude}, got ${actual.longitude} (${error.toFixed(3)}" off)`,
          ).toBeLessThan(tolerance);
        });

        it(`${name} latitude within ${tolerance}"`, async () => {
          const engine = await getEngine();
          const [year, month, day, hour, minute, second] = epoch.utc;
          const jd = await engine.julianDayFromUtc(year, month, day, hour, minute, second);
          const actual = await engine.position(jd, reference.se);

          const error = Math.abs(actual.latitude - reference.latitude) * 3600;
          expect(
            error,
            `${name} latitude at ${epoch.horizons}: expected ${reference.latitude}, got ${actual.latitude}`,
          ).toBeLessThan(tolerance);
        });
      }
    });
  }
});

describe('retrogradation follows the sign of longitude speed', () => {
  it('reports Pluto retrograde when its longitude speed is negative', async () => {
    const engine = await getEngine();
    const jd = await engine.julianDay(2000, 1, 1, 12);
    const pluto = await engine.position(jd, 9);
    expect(pluto.retrograde).toBe(pluto.longitudeSpeed < 0);
  });

  it('never reports the Sun retrograde', async () => {
    const engine = await getEngine();
    for (const month of [1, 4, 7, 10]) {
      const jd = await engine.julianDay(2024, month, 15, 12);
      const sun = await engine.position(jd, 0);
      expect(sun.retrograde, `Sun on 2024-${month}-15`).toBe(false);
      expect(sun.longitudeSpeed).toBeGreaterThan(0);
    }
  });
});

describe('refuses to compute outside the shipped ephemeris range', () => {
  it('rejects a date before 1800 rather than silently using fallback theory', async () => {
    const engine = await getEngine();
    const jd = await engine.julianDay(1750, 6, 1, 12);
    await expect(engine.position(jd, 0)).rejects.toThrow(/outside the shipped ephemeris range/);
  });

  it('rejects a date after 2399', async () => {
    const engine = await getEngine();
    const jd = await engine.julianDay(2500, 6, 1, 12);
    await expect(engine.position(jd, 0)).rejects.toThrow(/outside the shipped ephemeris range/);
  });
});
