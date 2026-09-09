/**
 * Integration tests for computeSecondaryProgression (#46).
 *
 * Runs against the real Swiss Ephemeris engine, never a mock: the whole point of
 * this function is that day-for-year body positions and the three MC methods are
 * genuine ephemeris behaviour, not arithmetic a mock could stand in for.
 */
import { describe, expect, it } from 'vitest';
import { angularSeparation } from '../src/astrology/aspects.js';
import { NAIBOD_DAILY_MOTION } from '../src/astrology/progressions.js';
import { computeSecondaryProgression } from '../src/domain/secondary-progression.js';
import { julianDayFor } from '../src/time/julian.js';
import { resolveMoment } from '../src/time/resolve.js';
import type { BirthMomentInput } from '../src/time/types.js';
import { arcsecondsBetween, getEngine } from './engine-harness.js';

const NATAL: BirthMomentInput = {
  civil: { year: 1990, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
  coordinates: { latitude: 38.7478, longitude: -85.0672 },
  offsetOverrideMinutes: -300,
};

const NATAL_PLACE = { latitude: NATAL.coordinates.latitude, longitude: NATAL.coordinates.longitude, altitude: 0 };

describe('computeSecondaryProgression (#46)', () => {
  it('progresses bodies by day-for-year: 30 years of age is 30 days of ephemeris motion', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 30;

    const progressed = await computeSecondaryProgression(NATAL, targetJd, engine);
    expect(progressed.ageInYears).toBeCloseTo(30, 6);
    expect(progressed.progressedJd).toBeCloseTo(natalJd + 30, 6);
    expect(progressed.positions.length).toBeGreaterThan(0);
  });

  it('records which MC method produced the houses, defaulting to naibod', async () => {
    const engine = await getEngine();
    const progressed = await computeSecondaryProgression(NATAL, 2460000, engine);
    expect(progressed.mcMethod).toBe('naibod');
    expect(progressed.houses.cusps).toHaveLength(13);
  });

  it('shifts naibod houses by the mean solar rate times age, regardless of the true sun', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 10; // 10 years of age

    const natalHouses = await engine.houses(natalJd, NATAL_PLACE, 'P');
    const progressed = await computeSecondaryProgression(NATAL, targetJd, engine, { mcMethod: 'naibod' });

    const expectedArc = 10 * NAIBOD_DAILY_MOTION;
    expect(arcsecondsBetween(progressed.houses.midheaven, natalHouses.midheaven + expectedArc)).toBeLessThan(1);
  });

  it('gives solarArc a different midheaven than naibod, since the true and mean sun rates differ', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 10;

    const naibod = await computeSecondaryProgression(NATAL, targetJd, engine, { mcMethod: 'naibod' });
    const solarArc = await computeSecondaryProgression(NATAL, targetJd, engine, { mcMethod: 'solarArc' });

    expect(arcsecondsBetween(naibod.houses.midheaven, solarArc.houses.midheaven)).toBeGreaterThan(1);
  });

  it('gives quotidian a markedly different ascendant than the symbolic methods over a decade', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 10;

    const naibod = await computeSecondaryProgression(NATAL, targetJd, engine, { mcMethod: 'naibod' });
    const quotidian = await computeSecondaryProgression(NATAL, targetJd, engine, { mcMethod: 'quotidian' });

    // The MCs stay close between the two methods (see progressions.ts's doc comment
    // for why), but the Ascendant is a non-linear function of sidereal time,
    // latitude and obliquity for quotidian rather than a rigid rotation of the
    // natal one, so it diverges from naibod's by a large margin over a decade.
    expect(arcsecondsBetween(naibod.houses.ascendant, quotidian.houses.ascendant)).toBeGreaterThan(3600);
  });

  it('respects an explicit house system for the houses that follow the progressed MC', async () => {
    const engine = await getEngine();
    const progressed = await computeSecondaryProgression(NATAL, 2460000, engine, { houseSystem: 'K' });
    expect(progressed.houses.system).toBe('K');
  });

  it('finds contacts between the progressed positions and the fixed natal chart (#51)', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 30;

    const progressed = await computeSecondaryProgression(NATAL, targetJd, engine);
    const natal = await computeSecondaryProgression(NATAL, natalJd, engine);
    expect(progressed.contacts.length).toBeGreaterThan(0);

    for (const contact of progressed.contacts) {
      const progressedPosition = progressed.positions.find((p) => p.body === contact.bodyA);
      const natalPosition = natal.positions.find((p) => p.body === contact.bodyB);
      expect(progressedPosition).toBeDefined();
      expect(natalPosition).toBeDefined();
      const separation = angularSeparation(progressedPosition?.longitude ?? 0, natalPosition?.longitude ?? 0);
      expect(Math.abs(separation - contact.aspect.angle)).toBeCloseTo(contact.orb, 6);
    }
  });

  it('narrows to fewer contacts with a tighter orb config (#51)', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 30;

    const wide = await computeSecondaryProgression(NATAL, targetJd, engine);
    const tight = await computeSecondaryProgression(NATAL, targetJd, engine, {}, { baseOrbs: {}, luminaryBonus: 0 });
    expect(tight.contacts).toHaveLength(0);
    expect(wide.contacts.length).toBeGreaterThan(0);
  });
});
