/**
 * Integration tests for computeDemibirthday (#50).
 *
 * Runs against the real Swiss Ephemeris engine, never a mock.
 */
import { describe, expect, it } from 'vitest';
import { angularSeparation } from '../src/astrology/aspects.js';
import { BODIES } from '../src/astrology/bodies.js';
import { computeDemibirthday } from '../src/domain/demibirthday.js';
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

describe('computeDemibirthday (#50)', () => {
  it('returns a chart whose Sun is exactly opposite the natal Sun longitude', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const [natalSun] = await engine.positions(natalJd, [SE.SE_SUN]);
    if (natalSun === undefined) throw new Error('unreachable: no position returned for the Sun');

    const result = await computeDemibirthday(NATAL, 2015, engine);
    const demibirthdaySun = result.positions.find((p) => p.body === SE.SE_SUN);

    expect(demibirthdaySun).toBeDefined();
    expect(arcsecondsBetween(demibirthdaySun?.longitude ?? 0, (natalSun.longitude + 180) % 360)).toBeLessThan(0.01);
    expect(result.year).toBe(2015);
    expect(result.houses.cusps).toHaveLength(13);
  });

  it('defaults the chart location to the birthplace', async () => {
    const engine = await getEngine();
    const result = await computeDemibirthday(NATAL, 2015, engine);
    expect(result.place.latitude).toBeCloseTo(NATAL.coordinates.latitude, 6);
    expect(result.place.longitude).toBeCloseTo(NATAL.coordinates.longitude, 6);
  });

  it('casts the chart at a chosen location, producing different houses', async () => {
    const engine = await getEngine();
    const birthplaceResult = await computeDemibirthday(NATAL, 2015, engine);
    const elsewhereResult = await computeDemibirthday(NATAL, 2015, engine, {
      place: { latitude: -33.8688, longitude: 151.2093, altitude: 0 },
    });

    expect(elsewhereResult.demibirthdayJd).toBe(birthplaceResult.demibirthdayJd);
    expect(elsewhereResult.houses.ascendant).not.toBeCloseTo(birthplaceResult.houses.ascendant, 0);
  });

  it('respects an explicit house system', async () => {
    const engine = await getEngine();
    const result = await computeDemibirthday(NATAL, 2015, engine, { houseSystem: 'K' });
    expect(result.houses.system).toBe('K');
  });

  it('finds contacts between the demibirthday positions and the natal chart (#51)', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const natalPositions = await engine.positions(
      natalJd,
      BODIES.map((b) => b.id),
    );

    const result = await computeDemibirthday(NATAL, 2015, engine);
    expect(result.contacts.length).toBeGreaterThan(0);

    for (const contact of result.contacts) {
      const chartPosition = result.positions.find((p) => p.body === contact.bodyA);
      const natalPosition = natalPositions.find((p) => p.body === contact.bodyB);
      expect(chartPosition).toBeDefined();
      expect(natalPosition).toBeDefined();
      const separation = angularSeparation(chartPosition?.longitude ?? 0, natalPosition?.longitude ?? 0);
      expect(Math.abs(separation - contact.aspect.angle)).toBeCloseTo(contact.orb, 6);
    }
  });

  it('narrows to fewer contacts with a tighter orb config (#51)', async () => {
    const engine = await getEngine();
    const wide = await computeDemibirthday(NATAL, 2015, engine);
    const tight = await computeDemibirthday(NATAL, 2015, engine, {}, { baseOrbs: {}, luminaryBonus: 0 });
    expect(tight.contacts).toHaveLength(0);
    expect(wide.contacts.length).toBeGreaterThan(0);
  });
});
