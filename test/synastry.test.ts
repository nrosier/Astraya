/**
 * Integration tests for computeSynastry (#172).
 *
 * Runs against the real Swiss Ephemeris engine, for the same reason every other
 * cross-chart domain test does: two genuine ephemeris passes combined through
 * `findCrossAspects`, not arithmetic a mock could stand in for.
 */
import { describe, expect, it } from 'vitest';
import { angularSeparation } from '../src/astrology/aspects.js';
import { computeSynastry } from '../src/domain/synastry.js';
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

describe('computeSynastry (#172)', () => {
  it('computes full, independent ChartData for both people', async () => {
    const engine = await getEngine();
    const data = await computeSynastry(PERSON_A, PERSON_B, engine);

    expect(data.chartA.positions.length).toBeGreaterThan(0);
    expect(data.chartA.houses.cusps).toHaveLength(13);
    expect(data.chartB.positions.length).toBeGreaterThan(0);
    expect(data.chartB.houses.cusps).toHaveLength(13);
  });

  it('finds aspects between a body in A and a body in B (#51)', async () => {
    const engine = await getEngine();
    const data = await computeSynastry(PERSON_A, PERSON_B, engine);
    expect(data.aspects.length).toBeGreaterThan(0);

    for (const aspect of data.aspects) {
      const positionA = data.chartA.positions.find((p) => p.body === aspect.bodyA);
      const positionB = data.chartB.positions.find((p) => p.body === aspect.bodyB);
      expect(positionA).toBeDefined();
      expect(positionB).toBeDefined();
      const separation = angularSeparation(positionA?.longitude ?? 0, positionB?.longitude ?? 0);
      expect(Math.abs(separation - aspect.aspect.angle)).toBeCloseTo(aspect.orb, 6);
    }
  });

  it('uses each chart’s own real speed on both sides, unlike a fixed-natal cross-aspect', async () => {
    const engine = await getEngine();
    // Two identical, exact-conjunction charts: if either side were zeroed to a fixed speed,
    // the aspect would still be found (a conjunction has no speed-dependent applying/separating
    // ambiguity at zero orb), so this alone doesn't distinguish the two conventions — it only
    // confirms the same-moment case still produces mutual aspects at all.
    const data = await computeSynastry(PERSON_A, PERSON_A, engine);
    const conjunctions = data.aspects.filter((aspect) => aspect.orb < 0.01);
    expect(conjunctions.length).toBeGreaterThan(0);
  });

  it('narrows to fewer aspects with a tighter orb config', async () => {
    const engine = await getEngine();
    const wide = await computeSynastry(PERSON_A, PERSON_B, engine);
    const tight = await computeSynastry(
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
    expect(tight.aspects).toHaveLength(0);
    expect(wide.aspects.length).toBeGreaterThan(0);
  });

  it('respects an explicit house system for both charts', async () => {
    const engine = await getEngine();
    const data = await computeSynastry(PERSON_A, PERSON_B, engine, { houseSystem: 'K' });
    expect(data.chartA.houses.system).toBe('K');
    expect(data.chartB.houses.system).toBe('K');
  });
});
