/**
 * Integration tests for computeProfections (#168).
 *
 * Runs against the real Swiss Ephemeris engine, never a mock: the natal Ascendant
 * comes from a genuine houses call, and the point of these tests is that the pure
 * sign-rotation math in `astrology/profections.ts` gets wired to it correctly.
 */
import { describe, expect, it } from 'vitest';
import { rulerOf } from '../src/astrology/dignities.js';
import { signIndex } from '../src/astrology/signs.js';
import { computeProfections } from '../src/domain/profections.js';
import { julianDayFor } from '../src/time/julian.js';
import { resolveMoment } from '../src/time/resolve.js';
import type { BirthMomentInput } from '../src/time/types.js';
import { getEngine } from './engine-harness.js';

const NATAL: BirthMomentInput = {
  civil: { year: 1990, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
  coordinates: { latitude: 38.7478, longitude: -85.0672 },
  offsetOverrideMinutes: -300,
};

const NATAL_PLACE = { latitude: NATAL.coordinates.latitude, longitude: NATAL.coordinates.longitude, altitude: 0 };

describe('computeProfections (#168)', () => {
  it('profects to the natal Ascendant itself at the moment of birth', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const natalHouses = await engine.houses(natalJd, NATAL_PLACE, 'P');

    const profected = await computeProfections(NATAL, natalJd, engine);
    expect(profected.age).toBeCloseTo(0, 6);
    expect(profected.year.signIndex).toBe(signIndex(natalHouses.ascendant));
    expect(profected.month.signIndex).toBe(signIndex(natalHouses.ascendant));
  });

  it('advances the year profection by one sign per completed 365.2425-day year of age', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const natalHouses = await engine.houses(natalJd, NATAL_PLACE, 'P');
    const targetJd = natalJd + 365.2425 * 5;

    const profected = await computeProfections(NATAL, targetJd, engine);
    expect(profected.age).toBeCloseTo(5, 5);
    expect(profected.year.signIndex).toBe((signIndex(natalHouses.ascendant) + 5) % 12);
  });

  it('resolves the Lord of the Year via traditional rulership by default', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 5;

    const profected = await computeProfections(NATAL, targetJd, engine);
    expect(profected.year.ruler).toBe(rulerOf(profected.year.signIndex, 'traditional'));
  });

  it('resolves the Lord of the Year with modern rulership when requested', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    // 8 years lands on a sign whose traditional and modern rulers differ (Scorpio/Aquarius family).
    const targetJd = natalJd + 365.2425 * 8;

    const profected = await computeProfections(NATAL, targetJd, engine, { scheme: 'modern' });
    expect(profected.year.ruler).toBe(rulerOf(profected.year.signIndex, 'modern'));
  });

  it('subdivides the year into monthly profections that start at the year’s own sign', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 3;

    const startOfYear = await computeProfections(NATAL, targetJd, engine);
    expect(startOfYear.month.monthIndex).toBe(0);
    expect(startOfYear.month.signIndex).toBe(startOfYear.year.signIndex);

    const sixMonthsIn = await computeProfections(NATAL, targetJd + 365.2425 / 2, engine);
    expect(sixMonthsIn.month.monthIndex).toBe(6);
    expect(sixMonthsIn.month.signIndex).toBe((startOfYear.year.signIndex + 6) % 12);
  });

  it('accepts an alternate house system for the natal Ascendant', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const koch = await engine.houses(natalJd, NATAL_PLACE, 'K');

    const profected = await computeProfections(NATAL, natalJd, engine, { houseSystem: 'K' });
    expect(profected.ascendant).toBeCloseTo(koch.ascendant, 6);
  });

  it('reports a negative age, without error, for a target before birth', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd - 365.2425 * 2;

    const profected = await computeProfections(NATAL, targetJd, engine);
    expect(profected.age).toBeCloseTo(-2, 5);
  });
});
