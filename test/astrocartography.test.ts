/**
 * Integration tests for computeAstrocartography (#171).
 *
 * Runs against the real Swiss Ephemeris engine, never a mock: `armc0`, the
 * equatorial positions, and the Local Space azimuths all come from actual
 * `houses`/`positions`/`azimuthAltitude` calls, modeled on `solar-return.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { HorizonLine } from '../src/astrology/astrocartography.js';
import {
  computeAstrocartography,
  EXTENDED_ACG_BODY_IDS,
  TRADITIONAL_ACG_BODY_IDS,
} from '../src/domain/astrocartography.js';
import { SE } from '../src/ephemeris/generated-constants.js';
import type { BirthMomentInput } from '../src/time/types.js';
import { getEngine } from './engine-harness.js';

const NATAL: BirthMomentInput = {
  civil: { year: 1990, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
  coordinates: { latitude: 38.7478, longitude: -85.0672 },
  offsetOverrideMinutes: -300,
};

describe('computeAstrocartography (#171)', () => {
  it('defaults to the traditional 7 bodies and all four line types', async () => {
    const engine = await getEngine();
    const result = await computeAstrocartography(NATAL, engine);

    const bodiesSeen = new Set(result.lines.map((line) => line.body));
    expect(bodiesSeen).toEqual(new Set(TRADITIONAL_ACG_BODY_IDS));
    // 4 line types (MC, IC, AC, DC) per body.
    expect(result.lines).toHaveLength(TRADITIONAL_ACG_BODY_IDS.length * 4);
    expect(result.localSpaceLines).toHaveLength(0);
    expect(result.relocatedHouses).toBeUndefined();
  });

  it('keeps every meridian-line longitude in [-180, 180)', async () => {
    const engine = await getEngine();
    const result = await computeAstrocartography(NATAL, engine);
    for (const line of result.lines) {
      if (line.kind !== 'MC' && line.kind !== 'IC') continue;
      expect(line.longitude).toBeGreaterThanOrEqual(-180);
      expect(line.longitude).toBeLessThan(180);
    }
  });

  it('samples a moderate-declination body across most of the latitude range', async () => {
    const engine = await getEngine();
    const result = await computeAstrocartography(NATAL, engine, {
      bodies: [SE.SE_SUN],
      lineTypes: ['AC'],
      sampling: { maxAbsLatitude: 60, latitudeStepDeg: 2 },
    });
    const ac = result.lines.find((line): line is HorizonLine => line.kind === 'AC');
    expect(ac).toBeDefined();
    expect(ac?.segments).toHaveLength(1);
    // June: the Sun's declination (~23.4°) is well within the tropics, so at
    // latitudes up to 60° it rises/sets everywhere — no circumpolar break yet.
    expect(ac?.segments[0]?.[0]?.latitude).toBeCloseTo(-60, 9);
    expect(ac?.segments[0]?.at(-1)?.latitude).toBeCloseTo(60, 9);
  });

  it('accepts the extended body set on top of the traditional one', async () => {
    const engine = await getEngine();
    const result = await computeAstrocartography(NATAL, engine, {
      bodies: [...TRADITIONAL_ACG_BODY_IDS, ...EXTENDED_ACG_BODY_IDS],
      lineTypes: ['MC'],
    });
    const bodiesSeen = new Set(result.lines.map((line) => line.body));
    for (const body of EXTENDED_ACG_BODY_IDS) expect(bodiesSeen.has(body)).toBe(true);
  });

  it('computes one Local Space line per requested body, with distinct forward/backward arms', async () => {
    const engine = await getEngine();
    const result = await computeAstrocartography(NATAL, engine, {
      bodies: [SE.SE_SUN, SE.SE_MOON],
      lineTypes: [],
      localSpace: true,
      localSpaceSampling: { stepDeg: 10, maxDistanceDeg: 30 },
    });
    expect(result.localSpaceLines).toHaveLength(2);
    for (const line of result.localSpaceLines) {
      expect(line.forward).not.toEqual(line.backward);
      expect(((line.azimuth % 360) + 360) % 360).toBeCloseTo(line.azimuth, 9);
    }
  });

  it('relocates the houses without changing the line geometry', async () => {
    const engine = await getEngine();
    const sydney = { latitude: -33.8688, longitude: 151.2093, altitude: 0 };

    const atBirthplace = await computeAstrocartography(NATAL, engine, { bodies: [SE.SE_SUN] });
    const relocated = await computeAstrocartography(NATAL, engine, {
      bodies: [SE.SE_SUN],
      relocationPlace: sydney,
    });
    const natalHouses = await engine.houses(atBirthplace.natalJd, atBirthplace.natalPlace, 'P');

    expect(relocated.relocatedHouses).toBeDefined();
    expect(relocated.relocatedHouses?.ascendant).not.toBeCloseTo(natalHouses.ascendant, 0);
    expect(relocated.lines).toEqual(atBirthplace.lines);
  });
});
