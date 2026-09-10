/**
 * Integration tests for computePlanetaryReturn (#50).
 *
 * Runs against the real Swiss Ephemeris engine, never a mock.
 */
import { describe, expect, it } from 'vitest';
import { angularSeparation } from '../src/astrology/aspects.js';
import { BODIES } from '../src/astrology/bodies.js';
import { computePlanetaryReturn } from '../src/domain/planetary-return.js';
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

describe('computePlanetaryReturn (#50)', () => {
  it('returns a chart whose body exactly matches the natal longitude, for a body with no dedicated root-finder', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const [natalMars] = await engine.positions(natalJd, [SE.SE_MARS]);
    if (natalMars === undefined) throw new Error('unreachable: no position returned for Mars');

    const result = await computePlanetaryReturn(NATAL, SE.SE_MARS, natalJd + 1, engine);
    const returnMars = result.positions.find((p) => p.body === SE.SE_MARS);

    expect(returnMars).toBeDefined();
    expect(arcsecondsBetween(returnMars?.longitude ?? 0, natalMars.longitude)).toBeLessThan(1);
    expect(result.returnJd).toBeGreaterThan(natalJd);
    expect(result.houses.cusps).toHaveLength(13);
  });

  it('casts the return chart at a chosen location, producing different houses', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));

    const birthplaceResult = await computePlanetaryReturn(NATAL, SE.SE_MERCURY, natalJd + 1, engine);
    const elsewhereResult = await computePlanetaryReturn(NATAL, SE.SE_MERCURY, natalJd + 1, engine, {
      place: { latitude: -33.8688, longitude: 151.2093, altitude: 0 },
    });

    expect(elsewhereResult.returnJd).toBe(birthplaceResult.returnJd);
    expect(elsewhereResult.houses.ascendant).not.toBeCloseTo(birthplaceResult.houses.ascendant, 0);
  });

  it('respects an explicit house system', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const result = await computePlanetaryReturn(NATAL, SE.SE_VENUS, natalJd + 1, engine, { houseSystem: 'K' });
    expect(result.houses.system).toBe('K');
  });

  it('finds contacts between the return positions and the natal chart (#51)', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const natalPositions = await engine.positions(
      natalJd,
      BODIES.map((b) => b.id),
    );

    const result = await computePlanetaryReturn(NATAL, SE.SE_MARS, natalJd + 1, engine);
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

    const wide = await computePlanetaryReturn(NATAL, SE.SE_MARS, natalJd + 1, engine);
    const tight = await computePlanetaryReturn(
      NATAL,
      SE.SE_MARS,
      natalJd + 1,
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
});
