/**
 * Real-engine tests for the station finder (#207's daily tier).
 *
 * Runs against the actual Swiss Ephemeris: the point is that a found station
 * genuinely has zero longitude speed there and the reported direction
 * matches which way the speed is heading, not merely that the arithmetic is
 * internally consistent.
 */
import { describe, expect, it } from 'vitest';
import { findStations } from '../src/astrology/stations.js';
import { SE } from '../src/ephemeris/generated-constants.js';
import type { JulianDayUT } from '../src/ephemeris/types.js';
import { getEngine } from './engine-harness.js';

const NATAL_JD = 2448088.104167; // 1990-06-15 14:30 UT, arbitrary fixed epoch

describe('findStations (#207)', () => {
  it('finds Mercury stationing within a window wide enough to guarantee one', async () => {
    const engine = await getEngine();
    // Mercury stations roughly every ~4 months (3-4 times a year), so 200 days is
    // comfortably wide enough to contain at least one.
    const fromJd: JulianDayUT = NATAL_JD;
    const toJd: JulianDayUT = fromJd + 200;

    const stations = await findStations(engine, [SE.SE_MERCURY], fromJd, toJd);
    expect(stations.length).toBeGreaterThan(0);

    for (const station of stations) {
      expect(station.jd).toBeGreaterThanOrEqual(fromJd);
      expect(station.jd).toBeLessThanOrEqual(toJd);

      const shortlyBefore = await engine.positions(station.jd - 0.01, [SE.SE_MERCURY]);
      const shortlyAfter = await engine.positions(station.jd + 0.01, [SE.SE_MERCURY]);
      const speedBefore = shortlyBefore[0]?.longitudeSpeed;
      const speedAfter = shortlyAfter[0]?.longitudeSpeed;
      if (speedBefore === undefined || speedAfter === undefined) throw new Error('unreachable: index within bounds');

      if (station.direction === 'retrograde') {
        expect(speedBefore).toBeGreaterThan(0);
        expect(speedAfter).toBeLessThan(0);
      } else {
        expect(speedBefore).toBeLessThan(0);
        expect(speedAfter).toBeGreaterThan(0);
      }

      const [atStation] = await engine.positions(station.jd, [SE.SE_MERCURY]);
      if (atStation === undefined) throw new Error('unreachable: index within bounds');
      expect(Math.abs(atStation.longitudeSpeed)).toBeLessThan(0.01);
    }
  });

  it('returns stations in chronological order across multiple bodies', async () => {
    const engine = await getEngine();
    const stations = await findStations(engine, [SE.SE_MERCURY, SE.SE_MARS], NATAL_JD, NATAL_JD + 365);
    for (let i = 1; i < stations.length; i++) {
      const previous = stations[i - 1];
      const current = stations[i];
      if (previous === undefined || current === undefined) throw new Error('unreachable: index within bounds');
      expect(current.jd).toBeGreaterThanOrEqual(previous.jd);
    }
  });

  it('returns nothing for an empty window', async () => {
    const engine = await getEngine();
    expect(await findStations(engine, [SE.SE_MERCURY], NATAL_JD, NATAL_JD)).toEqual([]);
  });

  it('rejects a window that ends before it starts', async () => {
    const engine = await getEngine();
    await expect(findStations(engine, [SE.SE_MERCURY], NATAL_JD, NATAL_JD - 1)).rejects.toThrow();
  });
});
