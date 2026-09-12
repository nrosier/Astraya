/**
 * Integration tests for computeTransit (#172).
 *
 * Runs against the real Swiss Ephemeris engine: the point of this module is that two real
 * ephemeris passes (natal, transiting) combine correctly through `findCrossAspects`, which a
 * mocked provider couldn't demonstrate.
 */
import { describe, expect, it } from 'vitest';
import { angularSeparation } from '../src/astrology/aspects.js';
import { computeTransit } from '../src/domain/transit.js';
import { julianDayFor } from '../src/time/julian.js';
import { resolveMoment } from '../src/time/resolve.js';
import type { BirthMomentInput } from '../src/time/types.js';
import { getEngine } from './engine-harness.js';

const NATAL: BirthMomentInput = {
  civil: { year: 1990, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
  coordinates: { latitude: 38.7478, longitude: -85.0672 },
  offsetOverrideMinutes: -300,
};

describe('computeTransit (#172)', () => {
  it('computes full ChartData for both the natal and transiting rings', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const data = await computeTransit(NATAL, natalJd + 100, engine);

    expect(data.natal.positions.length).toBeGreaterThan(0);
    expect(data.natal.houses.cusps).toHaveLength(13);
    expect(data.transit.positions.length).toBeGreaterThan(0);
    expect(data.transit.houses.cusps).toHaveLength(13);
  });

  it('casts the transiting houses for the natal place', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const data = await computeTransit(NATAL, natalJd + 100, engine);
    const directHouses = await engine.houses(natalJd + 100, { ...NATAL.coordinates, altitude: 0 }, 'P');
    expect(data.transit.houses.ascendant).toBeCloseTo(directHouses.ascendant, 6);
  });

  it('returns the same chart for both rings when transiting to the natal moment itself', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const data = await computeTransit(NATAL, natalJd, engine);
    expect(data.transit.houses.ascendant).toBeCloseTo(data.natal.houses.ascendant, 6);
    expect(data.transit.positions).toHaveLength(data.natal.positions.length);
  });

  it('finds contacts from the transiting (moving) positions to the fixed natal chart (#51)', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const data = await computeTransit(NATAL, natalJd + 365.2425 * 5, engine);
    expect(data.contacts.length).toBeGreaterThan(0);

    for (const contact of data.contacts) {
      const transitPosition = data.transit.positions.find((p) => p.body === contact.bodyA);
      const natalPosition = data.natal.positions.find((p) => p.body === contact.bodyB);
      expect(transitPosition).toBeDefined();
      expect(natalPosition).toBeDefined();
      const separation = angularSeparation(transitPosition?.longitude ?? 0, natalPosition?.longitude ?? 0);
      expect(Math.abs(separation - contact.aspect.angle)).toBeCloseTo(contact.orb, 6);
    }
  });

  it('narrows to fewer contacts with a tighter orb config', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 5;

    const wide = await computeTransit(NATAL, targetJd, engine);
    const tight = await computeTransit(
      NATAL,
      targetJd,
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
    expect(tight.contacts).toHaveLength(0);
    expect(wide.contacts.length).toBeGreaterThan(0);
  });

  it('respects an explicit house system for both rings', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const data = await computeTransit(NATAL, natalJd + 100, engine, { houseSystem: 'K' });
    expect(data.natal.houses.system).toBe('K');
    expect(data.transit.houses.system).toBe('K');
  });
});
