/**
 * Integration tests for computeLunarReturns (#49).
 *
 * Runs against the real Swiss Ephemeris engine, never a mock: each returned
 * chart's moment is an exact crossing found by the engine's own root-finder.
 */
import { describe, expect, it } from 'vitest';
import { angularSeparation } from '../src/astrology/aspects.js';
import { BODIES } from '../src/astrology/bodies.js';
import { SE } from '../src/ephemeris/generated-constants.js';
import { computeLunarReturns } from '../src/domain/lunar-returns.js';
import { julianDayFor } from '../src/time/julian.js';
import { resolveMoment } from '../src/time/resolve.js';
import type { BirthMomentInput } from '../src/time/types.js';
import { arcsecondsBetween, getEngine } from './engine-harness.js';

const NATAL: BirthMomentInput = {
  civil: { year: 1990, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
  coordinates: { latitude: 38.7478, longitude: -85.0672 },
  offsetOverrideMinutes: -300,
};

describe('computeLunarReturns (#49)', () => {
  it('returns roughly one chart per lunar month within the period', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const periodStart = natalJd + 365.2425 * 10;
    const periodEnd = periodStart + 365.2425;

    const result = await computeLunarReturns(NATAL, periodStart, periodEnd, engine);

    expect(result.returns.length).toBeGreaterThanOrEqual(12);
    expect(result.returns.length).toBeLessThanOrEqual(14);
  });

  it('each chart genuinely matches the natal Moon longitude', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const [natalMoon] = await engine.positions(natalJd, [SE.SE_MOON]);
    if (natalMoon === undefined) throw new Error('unreachable: the ephemeris returned no position for the Moon');

    const result = await computeLunarReturns(NATAL, natalJd, natalJd + 90, engine);
    for (const chart of result.returns) {
      const moon = chart.positions.find((p) => p.body === SE.SE_MOON);
      expect(moon).toBeDefined();
      expect(arcsecondsBetween(moon?.longitude ?? 0, natalMoon.longitude)).toBeLessThan(0.01);
      expect(chart.houses.cusps).toHaveLength(13);
    }
  });

  it('returns no charts for an empty period', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const result = await computeLunarReturns(NATAL, natalJd, natalJd - 1, engine);
    expect(result.returns).toEqual([]);
  });

  it('casts each chart at a chosen location, not necessarily the birthplace', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const periodStart = natalJd;
    const periodEnd = periodStart + 40;

    const birthplaceResult = await computeLunarReturns(NATAL, periodStart, periodEnd, engine);
    const elsewhereResult = await computeLunarReturns(NATAL, periodStart, periodEnd, engine, {
      place: { latitude: -33.8688, longitude: 151.2093, altitude: 0 },
    });

    expect(elsewhereResult.returns.length).toBe(birthplaceResult.returns.length);
    const [elsewhereFirst] = elsewhereResult.returns;
    const [birthplaceFirst] = birthplaceResult.returns;
    if (elsewhereFirst === undefined || birthplaceFirst === undefined) {
      throw new Error('unreachable: expected at least one lunar return in the period');
    }
    expect(elsewhereFirst.returnJd).toBe(birthplaceFirst.returnJd);
    expect(elsewhereFirst.houses.ascendant).not.toBeCloseTo(birthplaceFirst.houses.ascendant, 0);
  });

  it('respects an explicit house system', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const result = await computeLunarReturns(NATAL, natalJd, natalJd + 40, engine, { houseSystem: 'K' });
    const [first] = result.returns;
    expect(first?.houses.system).toBe('K');
  });

  it('finds contacts between each return and the natal chart (#51)', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const natalPositions = await engine.positions(
      natalJd,
      BODIES.map((b) => b.id),
    );

    const result = await computeLunarReturns(NATAL, natalJd, natalJd + 90, engine);
    expect(result.returns.length).toBeGreaterThan(0);

    for (const chart of result.returns) {
      expect(chart.contacts.length).toBeGreaterThan(0);
      for (const contact of chart.contacts) {
        const returnPosition = chart.positions.find((p) => p.body === contact.bodyA);
        const natalPosition = natalPositions.find((p) => p.body === contact.bodyB);
        expect(returnPosition).toBeDefined();
        expect(natalPosition).toBeDefined();
        const separation = angularSeparation(returnPosition?.longitude ?? 0, natalPosition?.longitude ?? 0);
        expect(Math.abs(separation - contact.aspect.angle)).toBeCloseTo(contact.orb, 6);
      }
    }
  });

  it('narrows to fewer contacts with a tighter orb config (#51)', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));

    const wide = await computeLunarReturns(NATAL, natalJd, natalJd + 90, engine);
    const tight = await computeLunarReturns(
      NATAL,
      natalJd,
      natalJd + 90,
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
    expect(tight.returns.every((chart) => chart.contacts.length === 0)).toBe(true);
    expect(wide.returns.some((chart) => chart.contacts.length > 0)).toBe(true);
  });
});
