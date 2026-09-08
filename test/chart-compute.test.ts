/**
 * Integration tests for computeChartData (#44).
 *
 * Runs against the real Swiss Ephemeris engine, never a mock: the whole point of this
 * function is to wire together time resolution, the ephemeris and the astrology layer
 * correctly, and a mocked provider would only prove the wiring around a fake.
 */
import { describe, expect, it } from 'vitest';
import { bodyByKey } from '../src/astrology/bodies.js';
import { computeChartData } from '../src/domain/chart-compute.js';
import type { BirthMomentInput } from '../src/time/types.js';
import { getEngine } from './engine-harness.js';

const MOMENT: BirthMomentInput = {
  civil: { year: 1990, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
  coordinates: { latitude: 38.7478, longitude: -85.0672 },
  offsetOverrideMinutes: -300,
};

describe('computeChartData (#44)', () => {
  it('computes a full chart from a birth moment', async () => {
    const engine = await getEngine();
    const data = await computeChartData(MOMENT, engine);

    expect(data.positions.length).toBeGreaterThan(0);
    expect(data.houses.cusps).toHaveLength(13);
    expect(data.houses.ascendant).toBeGreaterThanOrEqual(0);
    expect(data.houses.ascendant).toBeLessThan(360);
    expect(data.dignities.size).toBe(data.positions.length);
    expect(data.partOfFortune).toBeGreaterThanOrEqual(0);
    expect(data.partOfFortune).toBeLessThan(360);
    expect(data.partOfSpirit).toBeGreaterThanOrEqual(0);
    expect(data.partOfSpirit).toBeLessThan(360);
  });

  it('includes every body chart-tables.ts knows how to look up', async () => {
    const engine = await getEngine();
    const data = await computeChartData(MOMENT, engine);
    const sun = bodyByKey('sun');
    const moon = bodyByKey('moon');
    expect(sun).toBeDefined();
    expect(moon).toBeDefined();
    expect(data.positions.some((position) => position.body === sun?.id)).toBe(true);
    expect(data.positions.some((position) => position.body === moon?.id)).toBe(true);
  });

  it('reports day sect for a Sun above the horizon', async () => {
    // Noon local time puts the Sun well above the horizon at this latitude.
    const engine = await getEngine();
    const data = await computeChartData({ ...MOMENT, civil: { ...MOMENT.civil, hour: 12, minute: 0 } }, engine);
    expect(data.sect).toBe('day');
  });

  it('reports night sect for a Sun well below the horizon', async () => {
    const engine = await getEngine();
    const data = await computeChartData({ ...MOMENT, civil: { ...MOMENT.civil, hour: 23, minute: 0 } }, engine);
    expect(data.sect).toBe('night');
  });

  it('respects an explicit house system', async () => {
    const engine = await getEngine();
    const data = await computeChartData(MOMENT, engine, { houseSystem: 'K' });
    expect(data.houses.system).toBe('K');
  });
});
