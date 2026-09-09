import { describe, expect, it } from 'vitest';
import type { Aspect } from '../src/astrology/aspects.js';
import { bodyByKey } from '../src/astrology/bodies.js';
import type { EssentialDignities } from '../src/astrology/dignities.js';
import type { ChartData } from '../src/domain/chart-compute.js';
import {
  angleRows,
  aspectRows,
  chartWheelRing,
  degreeParts,
  derivedPointRows,
  dignityRows,
  houseCuspRows,
  positionRows,
} from '../src/domain/chart-tables.js';
import type { BodyId, BodyPosition, HousePositions } from '../src/ephemeris/types.js';

function idOf(key: string): BodyId {
  const body = bodyByKey(key);
  if (body === undefined) throw new Error(`test fixture bug: no body keyed "${key}"`);
  return body.id;
}

const SUN = idOf('sun');
const MOON = idOf('moon');
const MARS = idOf('mars');

function position(body: BodyId, longitude: number, longitudeSpeed = 1): BodyPosition {
  return {
    body,
    longitude,
    latitude: 0,
    distance: 1,
    longitudeSpeed,
    latitudeSpeed: 0,
    distanceSpeed: 0,
    retrograde: longitudeSpeed < 0,
  };
}

const HOUSES: HousePositions = {
  // Whole-sign-ish cusps for a chart with a 10-degree Aries Ascendant, purely for row-shape testing.
  cusps: [0, 10, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340],
  ascendant: 10,
  midheaven: 280,
  armc: 278,
  vertex: 200,
  equatorialAscendant: 12,
  coAscendantKoch: 14,
  coAscendantMunkasey: 16,
  polarAscendant: 18,
  system: 'P',
};

describe('degreeParts (#44)', () => {
  it('splits an ordinary longitude into sign, degree, minute and second', () => {
    // 37.5 degrees is 7 degrees 30 minutes into Taurus (30-60).
    expect(degreeParts(37.5)).toEqual({ sign: 'Taurus', degree: 7, minute: 30, second: 0 });
  });

  it('snaps to the sign boundary before splitting, rather than carrying a rounded second into the next sign', () => {
    // 29 degrees 59 minutes 59.6 seconds of Aries rounds to exactly 30 Aries (0 Taurus at the second), not
    // 30 Aries with a nonexistent 60th second while the sign lookup still says Aries.
    const almostThirty = 29 + 59 / 60 + 59.6 / 3600;
    expect(degreeParts(almostThirty)).toEqual({ sign: 'Taurus', degree: 0, minute: 0, second: 0 });
  });

  it('wraps a longitude outside [0, 360) before splitting', () => {
    expect(degreeParts(370)).toEqual(degreeParts(10));
  });
});

describe('positionRows (#44)', () => {
  const data: ChartData = {
    positions: [position(SUN, 10), position(MOON, 100, -0.5)],
    houses: HOUSES,
    aspects: [],
    dignities: new Map(),
    sect: 'day',
    partOfFortune: 0,
    partOfSpirit: 0,
  };

  it('resolves each position to its body name, degree parts, house and retrograde flag', () => {
    const rows = positionRows(data);
    expect(rows).toEqual([
      {
        bodyKey: 'sun',
        bodyName: 'Sun',
        longitude: 10,
        speed: 1,
        retrograde: false,
        house: 1,
        sign: 'Aries',
        degree: 10,
        minute: 0,
        second: 0,
      },
      {
        bodyKey: 'moon',
        bodyName: 'Moon',
        longitude: 100,
        speed: -0.5,
        retrograde: true,
        house: 4,
        sign: 'Cancer',
        degree: 10,
        minute: 0,
        second: 0,
      },
    ]);
  });
});

describe('houseCuspRows (#44)', () => {
  it('produces one row per house, skipping the unused index 0', () => {
    const data: ChartData = {
      positions: [],
      houses: HOUSES,
      aspects: [],
      dignities: new Map(),
      sect: 'day',
      partOfFortune: 0,
      partOfSpirit: 0,
    };
    const rows = houseCuspRows(data);
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({ house: 1, longitude: 10, ...degreeParts(10) });
    expect(rows[11]).toEqual({ house: 12, longitude: 340, ...degreeParts(340) });
  });
});

describe('angleRows (#44)', () => {
  it('lists all eight angles HousePositions carries', () => {
    const data: ChartData = {
      positions: [],
      houses: HOUSES,
      aspects: [],
      dignities: new Map(),
      sect: 'day',
      partOfFortune: 0,
      partOfSpirit: 0,
    };
    const rows = angleRows(data);
    expect(rows.map((row) => row.label)).toEqual([
      'Ascendant',
      'Midheaven',
      'ARMC',
      'Vertex',
      'Equatorial Ascendant',
      'Co-Ascendant (Koch)',
      'Co-Ascendant (Munkasey)',
      'Polar Ascendant',
    ]);
    expect(rows[0]).toMatchObject({ longitude: 10, sign: 'Aries', degree: 10 });
  });
});

describe('aspectRows (#44)', () => {
  it('resolves both bodies to names and carries the aspect through', () => {
    const aspect: Aspect = {
      bodyA: SUN,
      bodyB: MARS,
      aspect: { key: 'square', name: 'Square', angle: 90, family: 'major' },
      separation: 91,
      orb: 1,
      applying: true,
    };
    const data: ChartData = {
      positions: [],
      houses: HOUSES,
      aspects: [aspect],
      dignities: new Map(),
      sect: 'day',
      partOfFortune: 0,
      partOfSpirit: 0,
    };
    expect(aspectRows(data)).toEqual([
      {
        bodyAKey: 'sun',
        bodyAName: 'Sun',
        bodyBKey: 'mars',
        bodyBName: 'Mars',
        aspect: 'Square',
        angle: 90,
        separation: 91,
        orb: 1,
        applying: true,
      },
    ]);
  });
});

describe('dignityRows (#44)', () => {
  it('reads each dignity from the map, defaulting to false for a body missing from it', () => {
    const dignities = new Map<BodyId, EssentialDignities>([
      [SUN, { ruler: false, exalted: true, detriment: false, fall: false }],
    ]);
    const data: ChartData = {
      positions: [position(SUN, 10), position(MOON, 100)],
      houses: HOUSES,
      aspects: [],
      dignities,
      sect: 'day',
      partOfFortune: 0,
      partOfSpirit: 0,
    };
    expect(dignityRows(data)).toEqual([
      { bodyKey: 'sun', bodyName: 'Sun', ruler: false, exalted: true, detriment: false, fall: false },
      { bodyKey: 'moon', bodyName: 'Moon', ruler: false, exalted: false, detriment: false, fall: false },
    ]);
  });
});

describe('derivedPointRows (#44)', () => {
  it('lists Part of Fortune and Part of Spirit with their degree parts', () => {
    const data: ChartData = {
      positions: [],
      houses: HOUSES,
      aspects: [],
      dignities: new Map(),
      sect: 'night',
      partOfFortune: 45,
      partOfSpirit: 200,
    };
    expect(derivedPointRows(data)).toEqual([
      { label: 'Part of Fortune', longitude: 45, ...degreeParts(45) },
      { label: 'Part of Spirit', longitude: 200, ...degreeParts(200) },
    ]);
  });
});

describe('chartWheelRing (#52)', () => {
  it('shapes positions, houses and aspects into a WheelRingInput, defaulting the label to Natal', () => {
    const aspect: Aspect = {
      bodyA: SUN,
      bodyB: MARS,
      aspect: { key: 'square', name: 'Square', angle: 90, family: 'major' },
      separation: 91,
      orb: 1,
      applying: true,
    };
    const data: ChartData = {
      positions: [position(SUN, 10), position(MOON, 100)],
      houses: HOUSES,
      aspects: [aspect],
      dignities: new Map(),
      sect: 'day',
      partOfFortune: 0,
      partOfSpirit: 0,
    };
    expect(chartWheelRing(data)).toEqual({
      label: 'Natal',
      houses: HOUSES,
      bodies: [
        { body: SUN, key: 'sun', longitude: 10 },
        { body: MOON, key: 'moon', longitude: 100 },
      ],
      aspects: [aspect],
    });
  });

  it('uses a given label instead of the default', () => {
    const data: ChartData = {
      positions: [],
      houses: HOUSES,
      aspects: [],
      dignities: new Map(),
      sect: 'day',
      partOfFortune: 0,
      partOfSpirit: 0,
    };
    expect(chartWheelRing(data, 'Transiting').label).toBe('Transiting');
  });
});
