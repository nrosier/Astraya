/**
 * Integration tests for computeSolarArcDirections (#47).
 *
 * Runs against the real Swiss Ephemeris engine, never a mock: the whole point of
 * the technique is the true solar arc (not the mean rate), and the exactness
 * dates are resolved by bisecting against genuine ephemeris motion.
 */
import { describe, expect, it } from 'vitest';
import { BODIES, bodyByKey } from '../src/astrology/bodies.js';
import { ageInYears, mcArc, progressedJulianDay } from '../src/astrology/progressions.js';
import { arcsToExactness } from '../src/astrology/solar-arc-directions.js';
import { computeSecondaryProgression } from '../src/domain/secondary-progression.js';
import { computeSolarArcDirections } from '../src/domain/solar-arc-directions.js';
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

describe('computeSolarArcDirections (#47)', () => {
  it('directs every body and every house angle by the same arc', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 10;

    const natalHouses = await engine.houses(natalJd, NATAL_PLACE, 'P');
    const natalPositions = await engine.positions(
      natalJd,
      BODIES.map((body) => body.id),
    );

    const result = await computeSolarArcDirections(NATAL, targetJd, engine);

    for (const directed of result.directedPositions) {
      const natal = natalPositions.find((position) => position.body === directed.body);
      expect(natal).toBeDefined();
      expect(arcsecondsBetween(directed.longitude, (natal?.longitude ?? 0) + result.arc)).toBeLessThan(1);
    }
    expect(arcsecondsBetween(result.houses.midheaven, natalHouses.midheaven + result.arc)).toBeLessThan(1);
  });

  it('applies the same arc as secondary progression’s solarArc MC method', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 15;

    const directions = await computeSolarArcDirections(NATAL, targetJd, engine);
    const progression = await computeSecondaryProgression(NATAL, targetJd, engine, { mcMethod: 'solarArc' });

    expect(arcsecondsBetween(directions.houses.midheaven, progression.houses.midheaven)).toBeLessThan(1);
  });

  it('finds contacts to the natal chart over a long enough span, each a genuine in-orb aspect', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 80; // ~80 degree arc: plenty of chances for a contact

    const result = await computeSolarArcDirections(NATAL, targetJd, engine);
    expect(result.contacts.length).toBeGreaterThan(0);

    for (const contact of result.contacts) {
      expect(contact.orb).toBeGreaterThanOrEqual(0);
      expect(contact.orb).toBeLessThan(15); // generous upper bound covering every configured orb + luminary bonus
    }
  });

  it('resolves each contact’s exact date to the Julian day the real solar arc actually reaches it', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 80;

    const natalPositions = await engine.positions(
      natalJd,
      BODIES.map((body) => body.id),
    );
    const sun = bodyByKey('sun');
    if (sun === undefined) throw new Error('unreachable: sun is always in BODIES');
    const natalSun = natalPositions.find((position) => position.body === sun.id);
    if (natalSun === undefined) throw new Error('unreachable: the ephemeris returned no position for the Sun');

    const result = await computeSolarArcDirections(NATAL, targetJd, engine);
    const withExactDate = result.contacts.filter((contact) => contact.exactJd !== undefined);
    expect(withExactDate.length).toBeGreaterThan(0);

    for (const contact of withExactDate) {
      const directedNatal = natalPositions.find((position) => position.body === contact.bodyA);
      const targetNatal = natalPositions.find((position) => position.body === contact.bodyB);
      expect(directedNatal).toBeDefined();
      expect(targetNatal).toBeDefined();

      const candidates = arcsToExactness(
        directedNatal?.longitude ?? 0,
        targetNatal?.longitude ?? 0,
        contact.aspect.angle,
      );
      const requiredArc = candidates.reduce((closest, candidate) =>
        Math.abs(candidate - result.arc) < Math.abs(closest - result.arc) ? candidate : closest,
      );

      const exactJd = contact.exactJd;
      if (exactJd === undefined) throw new Error('unreachable: filtered to contacts with a defined exactJd');
      const age = ageInYears(natalJd, exactJd);
      const [sunAtExact] = await engine.positions(progressedJulianDay(natalJd, exactJd), [sun.id]);
      expect(sunAtExact).toBeDefined();
      const arcAtExact = mcArc('solarArc', age, natalSun.longitude, sunAtExact?.longitude ?? 0);

      expect(arcsecondsBetween(arcAtExact, requiredArc)).toBeLessThan(5);
      expect(exactJd).toBeGreaterThanOrEqual(natalJd);
    }
  });

  it('respects an explicit house system for the directed angles', async () => {
    const engine = await getEngine();
    const result = await computeSolarArcDirections(NATAL, 2460000, engine, { houseSystem: 'K' });
    expect(result.houses.system).toBe('K');
  });
});
