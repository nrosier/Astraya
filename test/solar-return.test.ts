/**
 * Integration tests for computeSolarReturn (#49).
 *
 * Runs against the real Swiss Ephemeris engine, never a mock: the return
 * moment is an exact crossing found by the engine's own root-finder.
 *
 * "Verify a known solar return against published values" (one of #49's
 * checklist items) is checked here only via internal consistency — the
 * returned chart's Sun exactly matches the natal Sun's longitude, and the
 * return date falls on the calendar-date anniversary of birth — since
 * WebSearch was unavailable in this environment to look up an externally
 * published return chart to compare against. Flagging this rather than
 * fabricating an external source.
 */
import { describe, expect, it } from 'vitest';
import { angularSeparation } from '../src/astrology/aspects.js';
import { BODIES } from '../src/astrology/bodies.js';
import { SE } from '../src/ephemeris/generated-constants.js';
import { computeSolarReturn } from '../src/domain/solar-return.js';
import { julianDayFor } from '../src/time/julian.js';
import { resolveMoment } from '../src/time/resolve.js';
import type { BirthMomentInput } from '../src/time/types.js';
import { arcsecondsBetween, getEngine } from './engine-harness.js';

const NATAL: BirthMomentInput = {
  civil: { year: 1990, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
  coordinates: { latitude: 38.7478, longitude: -85.0672 },
  offsetOverrideMinutes: -300,
};

describe('computeSolarReturn (#49)', () => {
  it('returns a chart whose Sun exactly matches the natal Sun longitude', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const [natalSun] = await engine.positions(natalJd, [SE.SE_SUN]);
    if (natalSun === undefined) throw new Error('unreachable: the ephemeris returned no position for the Sun');

    const result = await computeSolarReturn(NATAL, 2015, engine);
    const returnSun = result.positions.find((p) => p.body === SE.SE_SUN);
    expect(returnSun).toBeDefined();

    expect(arcsecondsBetween(returnSun?.longitude ?? 0, natalSun.longitude)).toBeLessThan(0.01);
    expect(result.year).toBe(2015);
    expect(result.houses.cusps).toHaveLength(13);
  });

  it('falls on the calendar-date anniversary of birth', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));

    const result = await computeSolarReturn(NATAL, 2020, engine);
    const anniversaryJd = natalJd + 365.2425 * 30;
    expect(Math.abs(result.returnJd - anniversaryJd)).toBeLessThan(1.5);
  });

  it('defaults the return chart location to the birthplace', async () => {
    const engine = await getEngine();
    const result = await computeSolarReturn(NATAL, 2015, engine);
    expect(result.place.latitude).toBeCloseTo(NATAL.coordinates.latitude, 6);
    expect(result.place.longitude).toBeCloseTo(NATAL.coordinates.longitude, 6);
  });

  it('casts the return chart at a chosen location, producing different houses', async () => {
    const engine = await getEngine();
    const birthplaceResult = await computeSolarReturn(NATAL, 2015, engine);
    const elsewhereResult = await computeSolarReturn(NATAL, 2015, engine, {
      place: { latitude: -33.8688, longitude: 151.2093, altitude: 0 },
    });

    // Same instant in time regardless of where it's cast for.
    expect(elsewhereResult.returnJd).toBe(birthplaceResult.returnJd);
    expect(elsewhereResult.houses.ascendant).not.toBeCloseTo(birthplaceResult.houses.ascendant, 0);
  });

  it('respects an explicit house system', async () => {
    const engine = await getEngine();
    const result = await computeSolarReturn(NATAL, 2015, engine, { houseSystem: 'K' });
    expect(result.houses.system).toBe('K');
  });

  it('finds contacts between the return positions and the natal chart (#51)', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const natalPositions = await engine.positions(
      natalJd,
      BODIES.map((b) => b.id),
    );

    const result = await computeSolarReturn(NATAL, 2015, engine);
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
    const wide = await computeSolarReturn(NATAL, 2015, engine);
    const tight = await computeSolarReturn(NATAL, 2015, engine, {}, { baseOrbs: {}, luminaryBonus: 0 });
    expect(tight.contacts).toHaveLength(0);
    expect(wide.contacts.length).toBeGreaterThan(0);
  });
});
