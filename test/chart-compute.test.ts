/**
 * Integration tests for computeChartData (#44).
 *
 * Runs against the real Swiss Ephemeris engine, never a mock: the whole point of this
 * function is to wire together time resolution, the ephemeris and the astrology layer
 * correctly, and a mocked provider would only prove the wiring around a fake.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ORB_CONFIG } from '../src/astrology/aspects.js';
import { bodyById, bodyByKey } from '../src/astrology/bodies.js';
import {
  computeChartData,
  computeChartDataAtJd,
  housesAreDefined,
  NATAL_FIXED_STARS,
} from '../src/domain/chart-compute.js';
import type { HousePositions } from '../src/ephemeris/types.js';
import { julianDayFor } from '../src/time/julian.js';
import { resolveMoment } from '../src/time/resolve.js';
import type { BirthMomentInput } from '../src/time/types.js';
import { getEngine } from './engine-harness.js';

const MOMENT: BirthMomentInput = {
  civil: { year: 1990, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
  coordinates: { latitude: 38.7478, longitude: -85.0672 },
  offsetOverrideMinutes: -300,
};

describe('computeChartData (#44)', () => {
  it('computes a full chart from a birth moment', async () => {
    const engine = await getEngine();
    const data = await computeChartData(MOMENT, engine);

    expect(data.positions.length).toBeGreaterThan(0);
    expect(data.houses.cusps).toHaveLength(13);
    expect(data.houses.ascendant).toBeGreaterThanOrEqual(0);
    expect(data.houses.ascendant).toBeLessThan(360);
    expect(data.dignities.size).toBe(data.positions.length);
    expect(data.partOfFortune).toBeGreaterThanOrEqual(0);
    expect(data.partOfFortune).toBeLessThan(360);
    expect(data.partOfSpirit).toBeGreaterThanOrEqual(0);
    expect(data.partOfSpirit).toBeLessThan(360);
  });

  it('includes every body chart-tables.ts knows how to look up', async () => {
    const engine = await getEngine();
    const data = await computeChartData(MOMENT, engine);
    const sun = bodyByKey('sun');
    const moon = bodyByKey('moon');
    expect(sun).toBeDefined();
    expect(moon).toBeDefined();
    expect(data.positions.some((position) => position.body === sun?.id)).toBe(true);
    expect(data.positions.some((position) => position.body === moon?.id)).toBe(true);
  });

  it('computes a plausible obliquity and declination per body (#398)', async () => {
    const engine = await getEngine();
    const data = await computeChartData(MOMENT, engine);
    // True obliquity of the ecliptic is ~23.4° and barely drifts over human timescales.
    expect(data.obliquity).toBeGreaterThan(23);
    expect(data.obliquity).toBeLessThan(24);
    expect(data.declinations?.size).toBe(data.positions.length);
    // No body's declination can exceed the obliquity by more than a body's own ecliptic
    // latitude could plausibly push it (a few degrees for the Moon/inner planets) — this is a
    // sanity bound, not a precise astronomical claim.
    for (const declination of data.declinations?.values() ?? []) {
      expect(Math.abs(declination)).toBeLessThan((data.obliquity ?? 0) + 10);
    }
  });

  it('resolves a longitude for every NATAL_FIXED_STARS name (#398)', async () => {
    const engine = await getEngine();
    const data = await computeChartData(MOMENT, engine);
    expect(data.fixedStars?.size).toBe(NATAL_FIXED_STARS.length);
    for (const name of NATAL_FIXED_STARS) {
      const longitude = data.fixedStars?.get(name);
      expect(longitude).toBeGreaterThanOrEqual(0);
      expect(longitude).toBeLessThan(360);
    }
  });

  it('reports day sect for a Sun above the horizon', async () => {
    // Noon local time puts the Sun well above the horizon at this latitude.
    const engine = await getEngine();
    const data = await computeChartData({ ...MOMENT, civil: { ...MOMENT.civil, hour: 12, minute: 0 } }, engine);
    expect(data.sect).toBe('day');
  });

  it('reports night sect for a Sun well below the horizon', async () => {
    const engine = await getEngine();
    const data = await computeChartData({ ...MOMENT, civil: { ...MOMENT.civil, hour: 23, minute: 0 } }, engine);
    expect(data.sect).toBe('night');
  });

  it('respects an explicit house system', async () => {
    const engine = await getEngine();
    const data = await computeChartData(MOMENT, engine, { houseSystem: 'K' });
    expect(data.houses.system).toBe('K');
  });

  it('carries exactly one Lilith and one Node model, defaulting to the mean ones (#52)', async () => {
    const engine = await getEngine();
    const data = await computeChartData(MOMENT, engine);
    const keys = data.positions.map((position) => bodyById(position.body)?.key);

    expect(keys).toContain('meanLilith');
    expect(keys).not.toContain('osculatingLilith');
    expect(keys).not.toContain('interpolatedLilith');
    expect(keys).toContain('meanNode');
    expect(keys).not.toContain('trueNode');
  });

  it('switches to the osculating Lilith and the true Node when asked (#52)', async () => {
    const engine = await getEngine();
    const data = await computeChartData(MOMENT, engine, { lilithVariant: 'true', nodeVariant: 'true' });
    const keys = data.positions.map((position) => bodyById(position.body)?.key);

    expect(keys).toContain('osculatingLilith');
    expect(keys).not.toContain('meanLilith');
    expect(keys).not.toContain('interpolatedLilith');
    expect(keys).toContain('trueNode');
    expect(keys).not.toContain('meanNode');
  });

  it('switches to interpolated Lilith when asked (#380)', async () => {
    const engine = await getEngine();
    const data = await computeChartData(MOMENT, engine, { lilithVariant: 'interpolated' });
    const keys = data.positions.map((position) => bodyById(position.body)?.key);

    expect(keys).toContain('interpolatedLilith');
    expect(keys).not.toContain('meanLilith');
    expect(keys).not.toContain('osculatingLilith');
  });

  it('excludes Chiron, Lilith and the Nodes from aspects by default, though they are still positioned (#52)', async () => {
    const engine = await getEngine();
    const data = await computeChartData(MOMENT, engine);
    const chiron = bodyByKey('chiron');
    const lilith = bodyByKey('meanLilith');
    const node = bodyByKey('meanNode');
    expect(chiron).toBeDefined();
    expect(lilith).toBeDefined();
    expect(node).toBeDefined();

    expect(data.positions.some((position) => position.body === chiron?.id)).toBe(true);
    expect(data.positions.some((position) => position.body === lilith?.id)).toBe(true);
    expect(data.positions.some((position) => position.body === node?.id)).toBe(true);

    const excludedIds = new Set([chiron?.id, lilith?.id, node?.id]);
    expect(data.aspects.some((aspect) => excludedIds.has(aspect.bodyA) || excludedIds.has(aspect.bodyB))).toBe(false);
  });

  it('includes Chiron, Lilith and the Nodes in aspects once asked for (#52)', async () => {
    const engine = await getEngine();
    const data = await computeChartData(MOMENT, engine, {
      aspectsTo: { chiron: true, lilith: true, lunarNodes: true },
    });
    const chiron = bodyByKey('chiron');
    const lilith = bodyByKey('meanLilith');
    const node = bodyByKey('meanNode');
    const includedIds = new Set([chiron?.id, lilith?.id, node?.id]);
    expect(data.aspects.some((aspect) => includedIds.has(aspect.bodyA) || includedIds.has(aspect.bodyB))).toBe(true);
  });

  it('passes orbConfig through to aspect-finding (#52)', async () => {
    const engine = await getEngine();
    const wide = await computeChartData(MOMENT, engine);
    const tight = await computeChartData(MOMENT, engine, {
      orbConfig: {
        majorOrb: { base: -1, luminaryBonus: 0 },
        sextileOrb: { base: -1, luminaryBonus: 0 },
        minorOrb: -1,
        scalePercent: 0,
        enabledMinorAspects: [],
      },
    });
    expect(tight.aspects).toHaveLength(0);
    expect(wide.aspects.length).toBeGreaterThan(0);
  });

  it('computeChartDataAtJd produces the same chart as computeChartData given the same jd and place (#172)', async () => {
    const engine = await getEngine();
    const resolved = resolveMoment(MOMENT);
    const jd = await julianDayFor(engine, resolved);
    const place = { ...MOMENT.coordinates, altitude: 0 };

    const viaMoment = await computeChartData(MOMENT, engine);
    const viaJd = await computeChartDataAtJd(jd, place, engine);

    expect(viaJd.houses.ascendant).toBeCloseTo(viaMoment.houses.ascendant, 9);
    expect(viaJd.positions).toEqual(viaMoment.positions);
    expect(viaJd.sect).toBe(viaMoment.sect);
  });
});

describe('housesAreDefined (#378)', () => {
  const VALID: HousePositions = {
    cusps: [Number.NaN, 10, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340],
    ascendant: 10,
    midheaven: 280,
    armc: 278,
    vertex: 55,
    equatorialAscendant: 12,
    coAscendantKoch: 15,
    coAscendantMunkasey: 16,
    polarAscendant: 17,
    system: 'P',
  };

  it('is true for a normal chart, ignoring cusps[0] (always NaN by design)', () => {
    expect(housesAreDefined(VALID)).toBe(true);
  });

  it('is false when a house system has no solution at this latitude (NaN cusps, engine.ts’s own shape)', () => {
    const degenerate: HousePositions = { ...VALID, cusps: VALID.cusps.map(() => Number.NaN) };
    expect(housesAreDefined(degenerate)).toBe(false);
  });

  it('is false when only the ascendant or midheaven is NaN, even if every cusp is finite', () => {
    expect(housesAreDefined({ ...VALID, ascendant: Number.NaN })).toBe(false);
    expect(housesAreDefined({ ...VALID, midheaven: Number.NaN })).toBe(false);
  });

  it('is false when just one real cusp (not index 0) is NaN', () => {
    const oneBadCusp = [...VALID.cusps];
    oneBadCusp[7] = Number.NaN;
    expect(housesAreDefined({ ...VALID, cusps: oneBadCusp })).toBe(false);
  });
});

/**
 * The chart in the Astro-Seek reference sheet (#413): 1 Jan 1970 00:00, Antwerp OH. Its grid
 * prints these ASC/MC aspects, which are what the expected values below are taken from.
 */
describe('angle aspects (#413)', () => {
  const REFERENCE: BirthMomentInput = {
    civil: { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
    coordinates: { latitude: 41.1833, longitude: -84.7333 },
    zoneOverride: 'America/New_York',
  };

  async function referenceAngleAspects(): Promise<
    NonNullable<Awaited<ReturnType<typeof computeChartData>>['angleAspects']>
  > {
    const data = await computeChartData(REFERENCE, await getEngine());
    return data.angleAspects ?? [];
  }

  it('finds the Ascendant square the Sun, applying, about 10° wide', async () => {
    const sun = bodyByKey('sun');
    const found = (await referenceAngleAspects()).find((a) => a.angle === 'asc' && a.body === sun?.id);
    expect(found?.aspect.key).toBe('square');
    expect(found?.applying).toBe(true);
    expect(found?.separation).toBeGreaterThan(99);
    expect(found?.separation).toBeLessThan(100.5);
  });

  it('finds the Midheaven opposite the Sun, applying, about 10° out on the short side', async () => {
    const sun = bodyByKey('sun');
    const found = (await referenceAngleAspects()).find((a) => a.angle === 'mc' && a.body === sun?.id);
    expect(found?.aspect.key).toBe('opposition');
    expect(found?.applying).toBe(true);
    expect(found?.orb).toBeGreaterThan(9.4);
    expect(found?.orb).toBeLessThan(10);
    // Short of exact: the separation is under 180°.
    expect(found?.separation).toBeLessThan(180);
  });

  it('gives only aspects within the configured orb, so a wider orb scale finds at least as many', async () => {
    const engine = await getEngine();
    const base = await computeChartData(REFERENCE, engine);
    const wide = await computeChartData(REFERENCE, engine, {
      orbConfig: { ...DEFAULT_ORB_CONFIG, scalePercent: 50 },
    });
    expect((wide.angleAspects ?? []).length).toBeGreaterThanOrEqual((base.angleAspects ?? []).length);
  });

  it('leaves out Chiron, Lilith and the Nodes unless asked, exactly as for body-to-body aspects', async () => {
    const engine = await getEngine();
    const without = await computeChartData(REFERENCE, engine);
    const centaur = bodyByKey('chiron');
    expect((without.angleAspects ?? []).some((a) => a.body === centaur?.id)).toBe(false);
  });
});
