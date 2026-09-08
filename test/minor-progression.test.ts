/**
 * Integration tests for computeMinorProgression (#48).
 *
 * Runs against the real Swiss Ephemeris engine, never a mock: the point of
 * this function is that bodies and houses at the progressed Julian day are
 * genuine ephemeris/house-system behaviour, not arithmetic a mock could
 * stand in for.
 */
import { describe, expect, it } from 'vitest';
import { SYNODIC_MONTH_DAYS } from '../src/astrology/minor-progressions.js';
import { computeMinorProgression } from '../src/domain/minor-progression.js';
import { julianDayFor } from '../src/time/julian.js';
import { resolveMoment } from '../src/time/resolve.js';
import type { BirthMomentInput } from '../src/time/types.js';
import { getEngine } from './engine-harness.js';

const NATAL: BirthMomentInput = {
  civil: { year: 1990, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
  coordinates: { latitude: 38.7478, longitude: -85.0672 },
  offsetOverrideMinutes: -300,
};

describe('computeMinorProgression (#48)', () => {
  it('tertiary: one lunar month of real time progresses the sky by one day', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + SYNODIC_MONTH_DAYS * 7; // 7 lunar months of real time

    const progressed = await computeMinorProgression('tertiary', NATAL, targetJd, engine);
    expect(progressed.method).toBe('tertiary');
    expect(progressed.progressedJd).toBeCloseTo(natalJd + 7, 6);
    expect(progressed.positions.length).toBeGreaterThan(0);
    expect(progressed.houses.cusps).toHaveLength(13);
  });

  it('minor: one year of real time progresses the sky by one lunar month', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 4; // 4 years of real time

    const progressed = await computeMinorProgression('minor', NATAL, targetJd, engine);
    expect(progressed.method).toBe('minor');
    expect(progressed.progressedJd).toBeCloseTo(natalJd + 4 * SYNODIC_MONTH_DAYS, 6);
    expect(progressed.ageInYears).toBeCloseTo(4, 6);
  });

  it('gives tertiary and minor visibly different charts for the same target date', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 20;

    const tertiary = await computeMinorProgression('tertiary', NATAL, targetJd, engine);
    const minor = await computeMinorProgression('minor', NATAL, targetJd, engine);

    expect(tertiary.progressedJd).not.toBeCloseTo(minor.progressedJd, 0);
  });

  it('respects an explicit house system', async () => {
    const engine = await getEngine();
    const progressed = await computeMinorProgression('minor', NATAL, 2460000, engine, { houseSystem: 'K' });
    expect(progressed.houses.system).toBe('K');
  });

  it('reports the same real chronological age regardless of method', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const targetJd = natalJd + 365.2425 * 12.5;

    const tertiary = await computeMinorProgression('tertiary', NATAL, targetJd, engine);
    const minor = await computeMinorProgression('minor', NATAL, targetJd, engine);

    expect(tertiary.ageInYears).toBeCloseTo(12.5, 6);
    expect(minor.ageInYears).toBeCloseTo(12.5, 6);
  });
});
