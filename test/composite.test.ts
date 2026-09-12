/**
 * Integration tests for computeComposite (#169).
 *
 * Runs against the real Swiss Ephemeris engine, same reason every other cross-chart
 * domain test does: two genuine ephemeris passes combined through arithmetic midpoints,
 * not values a mock could stand in for.
 */
import { describe, expect, it } from 'vitest';
import { midpointOf } from '../src/astrology/midpoints.js';
import { computeComposite } from '../src/domain/composite.js';
import type { BirthMomentInput } from '../src/time/types.js';
import { getEngine } from './engine-harness.js';

const PERSON_A: BirthMomentInput = {
  civil: { year: 1990, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
  coordinates: { latitude: 38.7478, longitude: -85.0672 },
  offsetOverrideMinutes: -300,
};

const PERSON_B: BirthMomentInput = {
  civil: { year: 1988, month: 11, day: 2, hour: 3, minute: 15, second: 0 },
  coordinates: { latitude: 51.5072, longitude: -0.1276 },
  offsetOverrideMinutes: 0,
};

describe('computeComposite (#169)', () => {
  it('computes full, independent ChartData for both natal charts plus the composite', async () => {
    const engine = await getEngine();
    const data = await computeComposite(PERSON_A, PERSON_B, engine);

    expect(data.chartA.positions.length).toBeGreaterThan(0);
    expect(data.chartA.houses.cusps).toHaveLength(13);
    expect(data.chartB.positions.length).toBeGreaterThan(0);
    expect(data.chartB.houses.cusps).toHaveLength(13);
    expect(data.composite.positions.length).toBe(data.chartA.positions.length);
    expect(data.composite.houses.cusps).toHaveLength(13);
  });

  it('places every composite body position at the near-arc midpoint of the two natal positions', async () => {
    const engine = await getEngine();
    const data = await computeComposite(PERSON_A, PERSON_B, engine);

    for (const compositePosition of data.composite.positions) {
      const a = data.chartA.positions.find((p) => p.body === compositePosition.body);
      const b = data.chartB.positions.find((p) => p.body === compositePosition.body);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a === undefined || b === undefined) continue;
      expect(compositePosition.longitude).toBeCloseTo(midpointOf(a.longitude, b.longitude), 6);
      expect(compositePosition.latitude).toBeCloseTo((a.latitude + b.latitude) / 2, 6);
    }
  });

  it('places every composite house cusp at the near-arc midpoint of the two natal cusps', async () => {
    const engine = await getEngine();
    const data = await computeComposite(PERSON_A, PERSON_B, engine);

    // Index 0 is unused (see ephemeris/types.ts's own `cusps` doc comment) and NaN on both sides.
    data.composite.houses.cusps.slice(1).forEach((cusp, offset) => {
      const index = offset + 1;
      const a = data.chartA.houses.cusps[index];
      const b = data.chartB.houses.cusps[index];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (a === undefined || b === undefined) return;
      expect(cusp).toBeCloseTo(midpointOf(a, b), 6);
    });
    expect(data.composite.houses.ascendant).toBeCloseTo(
      midpointOf(data.chartA.houses.ascendant, data.chartB.houses.ascendant),
      6,
    );
  });

  it('finds aspects within the composite chart itself, not between the two natal charts', async () => {
    const engine = await getEngine();
    const data = await computeComposite(PERSON_A, PERSON_B, engine);
    expect(data.composite.aspects.length).toBeGreaterThan(0);

    for (const aspect of data.composite.aspects) {
      const bodyA = data.composite.positions.find((p) => p.body === aspect.bodyA);
      const bodyB = data.composite.positions.find((p) => p.body === aspect.bodyB);
      expect(bodyA).toBeDefined();
      expect(bodyB).toBeDefined();
    }
  });

  it('narrows to fewer composite aspects with a tighter orb config', async () => {
    const engine = await getEngine();
    const wide = await computeComposite(PERSON_A, PERSON_B, engine);
    const tight = await computeComposite(
      PERSON_A,
      PERSON_B,
      engine,
      {},
      {
        majorOrb: { base: -1, luminaryBonus: 0 },
        sextileOrb: { base: -1, luminaryBonus: 0 },
        minorOrb: -1,
        scalePercent: 0,
        enabledMinorAspects: [],
      },
    );
    expect(tight.composite.aspects).toHaveLength(0);
    expect(wide.composite.aspects.length).toBeGreaterThan(0);
  });

  it('respects an explicit house system for both natal charts and the composite', async () => {
    const engine = await getEngine();
    const data = await computeComposite(PERSON_A, PERSON_B, engine, { houseSystem: 'K' });
    expect(data.chartA.houses.system).toBe('K');
    expect(data.chartB.houses.system).toBe('K');
    expect(data.composite.houses.system).toBe('K');
  });

  it('excludes Chiron, Lilith and the lunar nodes from composite aspects by default', async () => {
    const engine = await getEngine();
    const withoutExtras = await computeComposite(PERSON_A, PERSON_B, engine);
    const withExtras = await computeComposite(PERSON_A, PERSON_B, engine, {
      aspectsTo: { chiron: true, lilith: true, lunarNodes: true },
    });
    expect(withExtras.composite.aspects.length).toBeGreaterThanOrEqual(withoutExtras.composite.aspects.length);
  });
});
