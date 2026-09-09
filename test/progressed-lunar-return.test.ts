/**
 * Integration tests for computeProgressedLunarReturn (#50).
 *
 * Runs against the real Swiss Ephemeris engine, never a mock.
 */
import { describe, expect, it } from 'vitest';
import { angularSeparation } from '../src/astrology/aspects.js';
import { BODIES } from '../src/astrology/bodies.js';
import { SYNODIC_MONTH_DAYS } from '../src/astrology/minor-progressions.js';
import { computeProgressedLunarReturn } from '../src/domain/progressed-lunar-return.js';
import { SE } from '../src/ephemeris/generated-constants.js';
import { julianDayFor } from '../src/time/julian.js';
import { resolveMoment } from '../src/time/resolve.js';
import type { BirthMomentInput } from '../src/time/types.js';
import { arcsecondsBetween, getEngine } from './engine-harness.js';

const NATAL: BirthMomentInput = {
  civil: { year: 1990, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
  coordinates: { latitude: 38.7478, longitude: -85.0672 },
  offsetOverrideMinutes: -300,
};

describe('computeProgressedLunarReturn (#50)', () => {
  it('returns a chart whose Moon exactly matches the progressed Moon longitude, at or before the target date', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 20;

    const result = await computeProgressedLunarReturn(NATAL, targetJd, engine);
    const returnMoon = result.positions.find((p) => p.body === SE.SE_MOON);

    expect(returnMoon).toBeDefined();
    expect(arcsecondsBetween(returnMoon?.longitude ?? 0, result.progressedMoonLongitude)).toBeLessThan(0.01);
    expect(result.returnJd).toBeLessThanOrEqual(targetJd);
    expect(targetJd - result.returnJd).toBeLessThan(SYNODIC_MONTH_DAYS);
    expect(result.houses.cusps).toHaveLength(13);
  });

  it('casts the chart at a chosen location, producing different houses', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 5;

    const birthplaceResult = await computeProgressedLunarReturn(NATAL, targetJd, engine);
    const elsewhereResult = await computeProgressedLunarReturn(NATAL, targetJd, engine, {
      place: { latitude: -33.8688, longitude: 151.2093, altitude: 0 },
    });

    expect(elsewhereResult.returnJd).toBe(birthplaceResult.returnJd);
    expect(elsewhereResult.houses.ascendant).not.toBeCloseTo(birthplaceResult.houses.ascendant, 0);
  });

  it('respects an explicit house system', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const result = await computeProgressedLunarReturn(NATAL, natalJd + 365.2425 * 3, engine, { houseSystem: 'K' });
    expect(result.houses.system).toBe('K');
  });

  it('finds contacts between the return positions and the natal chart (#51)', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 20;
    const natalPositions = await engine.positions(
      natalJd,
      BODIES.map((b) => b.id),
    );

    const result = await computeProgressedLunarReturn(NATAL, targetJd, engine);
    expect(result.contacts.length).toBeGreaterThan(0);

    for (const contact of result.contacts) {
      const returnPosition = result.positions.find((p) => p.body === contact.bodyA);
      const natalPosition = natalPositions.find((p) => p.body === contact.bodyB);
      expect(returnPosition).toBeDefined();
      expect(natalPosition).toBeDefined();
      const separation = angularSeparation(returnPosition?.longitude ?? 0, natalPosition?.longitude ?? 0);
      expect(Math.abs(separation - contact.aspect.angle)).toBeCloseTo(contact.orb, 6);
    }
  });

  it('narrows to fewer contacts with a tighter orb config (#51)', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 20;

    const wide = await computeProgressedLunarReturn(NATAL, targetJd, engine);
    const tight = await computeProgressedLunarReturn(NATAL, targetJd, engine, {}, { baseOrbs: {}, luminaryBonus: 0 });
    expect(tight.contacts).toHaveLength(0);
    expect(wide.contacts.length).toBeGreaterThan(0);
  });
});
