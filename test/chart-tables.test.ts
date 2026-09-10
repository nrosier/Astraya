import { describe, expect, it } from 'vitest';
import type { Aspect } from '../src/astrology/aspects.js';
import { bodyByKey } from '../src/astrology/bodies.js';
import type { EssentialDignities } from '../src/astrology/dignities.js';
import type { ChartData } from '../src/domain/chart-compute.js';
import {
  angleRows,
  aspectRows,
  chartSheetInput,
  chartSheetMetaLines,
  chartWheelRing,
  degreeParts,
  derivedPointRows,
  dignityRows,
  houseCuspRows,
  positionRows,
} from '../src/domain/chart-tables.js';
import type { BodyId, BodyPosition, HousePositions } from '../src/ephemeris/types.js';
import type { BirthMomentInput } from '../src/time/types.js';

function idOf(key: string): BodyId {
  const body = bodyByKey(key);
  if (body === undefined) throw new Error(`test fixture bug: no body keyed "${key}"`);
  return body.id;
}

const SUN = idOf('sun');
const MOON = idOf('moon');
const MARS = idOf('mars');
const CHIRON = idOf('chiron');

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

  it('keeps Chiron by default but drops it when chironVisible is false', () => {
    const withChiron: ChartData = { ...data, positions: [...data.positions, position(CHIRON, 50)] };
    expect(positionRows(withChiron).map((row) => row.bodyKey)).toEqual(['sun', 'moon', 'chiron']);
    expect(positionRows(withChiron, { chironVisible: false }).map((row) => row.bodyKey)).toEqual(['sun', 'moon']);
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
  it('lists seven angles by default, omitting the Vertex', () => {
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
      'Equatorial Ascendant',
      'Co-Ascendant (Koch)',
      'Co-Ascendant (Munkasey)',
      'Polar Ascendant',
    ]);
    expect(rows[0]).toMatchObject({ longitude: 10, sign: 'Aries', degree: 10 });
  });

  it('includes the Vertex once vertexVisible is true', () => {
    const data: ChartData = {
      positions: [],
      houses: HOUSES,
      aspects: [],
      dignities: new Map(),
      sect: 'day',
      partOfFortune: 0,
      partOfSpirit: 0,
    };
    const rows = angleRows(data, { vertexVisible: true });
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

  it('keeps Chiron by default but drops it when chironVisible is false', () => {
    const dignities = new Map<BodyId, EssentialDignities>();
    const data: ChartData = {
      positions: [position(SUN, 10), position(CHIRON, 50)],
      houses: HOUSES,
      aspects: [],
      dignities,
      sect: 'day',
      partOfFortune: 0,
      partOfSpirit: 0,
    };
    expect(dignityRows(data).map((row) => row.bodyKey)).toEqual(['sun', 'chiron']);
    expect(dignityRows(data, { chironVisible: false }).map((row) => row.bodyKey)).toEqual(['sun']);
  });
});

describe('derivedPointRows (#44)', () => {
  const data: ChartData = {
    positions: [position(SUN, 10), position(MOON, 100)],
    houses: HOUSES,
    aspects: [],
    dignities: new Map(),
    sect: 'night',
    partOfFortune: 45,
    partOfSpirit: 200,
  };

  it('lists only Part of Spirit by default, omitting Part of Fortune and the midpoints', () => {
    expect(derivedPointRows(data)).toEqual([{ label: 'Part of Spirit', longitude: 200, ...degreeParts(200) }]);
  });

  it('includes Part of Fortune once fortuneVisible is true', () => {
    expect(derivedPointRows(data, { fortuneVisible: true })).toEqual([
      { label: 'Part of Fortune', longitude: 45, ...degreeParts(45) },
      { label: 'Part of Spirit', longitude: 200, ...degreeParts(200) },
    ]);
  });

  it('adds the ASC/MC and Sun/Moon midpoints once midpointsVisible is true', () => {
    // ASC 10, MC 280: shorter arc midpoint is 325 (Aquarius 25). Sun 10, Moon 100: midpoint is 55 (Taurus 25).
    expect(derivedPointRows(data, { midpointsVisible: true })).toEqual([
      { label: 'Part of Spirit', longitude: 200, ...degreeParts(200) },
      { label: 'ASC/MC Midpoint', longitude: 325, ...degreeParts(325) },
      { label: 'Sun/Moon Midpoint', longitude: 55, ...degreeParts(55) },
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

  it('drops minor aspects from the wheel, keeping only the five major ones', () => {
    const major: Aspect = {
      bodyA: SUN,
      bodyB: MARS,
      aspect: { key: 'square', name: 'Square', angle: 90, family: 'major' },
      separation: 91,
      orb: 1,
      applying: true,
    };
    const minor: Aspect = {
      bodyA: SUN,
      bodyB: MOON,
      aspect: { key: 'quincunx', name: 'Quincunx', angle: 150, family: 'minor' },
      separation: 149,
      orb: 1,
      applying: true,
    };
    const data: ChartData = {
      positions: [position(SUN, 10), position(MOON, 100), position(MARS, 101)],
      houses: HOUSES,
      aspects: [major, minor],
      dignities: new Map(),
      sect: 'day',
      partOfFortune: 0,
      partOfSpirit: 0,
    };
    expect(chartWheelRing(data).aspects).toEqual([major]);
  });

  it('keeps Chiron in the wheel bodies by default, dropping it when chironVisible is false, aspects untouched', () => {
    const aspect: Aspect = {
      bodyA: SUN,
      bodyB: CHIRON,
      aspect: { key: 'square', name: 'Square', angle: 90, family: 'major' },
      separation: 91,
      orb: 1,
      applying: true,
    };
    const data: ChartData = {
      positions: [position(SUN, 10), position(CHIRON, 100)],
      houses: HOUSES,
      aspects: [aspect],
      dignities: new Map(),
      sect: 'day',
      partOfFortune: 0,
      partOfSpirit: 0,
    };
    expect(chartWheelRing(data).bodies).toEqual([
      { body: SUN, key: 'sun', longitude: 10 },
      { body: CHIRON, key: 'chiron', longitude: 100 },
    ]);
    expect(chartWheelRing(data).aspects).toEqual([aspect]);
    expect(chartWheelRing(data, 'Natal', { chironVisible: false }).bodies).toEqual([
      { body: SUN, key: 'sun', longitude: 10 },
    ]);
    expect(chartWheelRing(data, 'Natal', { chironVisible: false }).aspects).toEqual([aspect]);
  });
});

describe('chartSheetInput', () => {
  const aspect: Aspect = {
    bodyA: SUN,
    bodyB: MARS,
    aspect: { key: 'square', name: 'Square', angle: 90, family: 'major' },
    separation: 91,
    orb: 1,
    applying: true,
  };
  const data: ChartData = {
    positions: [position(SUN, 10), position(MOON, 100), position(MARS, 101)],
    houses: HOUSES,
    aspects: [aspect],
    dignities: new Map(),
    sect: 'day',
    partOfFortune: 0,
    partOfSpirit: 0,
  };

  it('gives every panel the same bodies, in ChartData order', () => {
    const input = chartSheetInput(data);
    expect(input.matrix.bodies.map((body) => body.key)).toEqual(['sun', 'moon', 'mars']);
    expect(input.emphasis.bodies.map((body) => body.key)).toEqual(['sun', 'moon', 'mars']);
    expect(input.strip.bodies.map((body) => body.key)).toEqual(['sun', 'moon', 'mars']);
  });

  it('labels matrix rows by body name, for the bodies whose glyph is missing', () => {
    expect(chartSheetInput(data).matrix.bodies).toEqual([
      { key: 'sun', label: 'Sun' },
      { key: 'moon', label: 'Moon' },
      { key: 'mars', label: 'Mars' },
    ]);
  });

  it('passes the engine aspects through by key, never re-deriving them', () => {
    expect(chartSheetInput(data).matrix.aspects).toEqual([
      { aKey: 'sun', bKey: 'mars', aspectKey: 'square', orb: 1, applying: true },
    ]);
  });

  it('wraps the chart as a single wheel ring, with the label it is given', () => {
    const input = chartSheetInput(data, [], 'Solar return');
    expect(input.rings).toHaveLength(1);
    expect(input.rings[0]?.label).toBe('Solar return');
    expect(input.rings[0]?.aspects).toEqual([aspect]);
  });

  it('carries the header lines through untouched, defaulting to none', () => {
    expect(chartSheetInput(data).metaLines).toEqual([]);
    expect(chartSheetInput(data, ['A', 'B']).metaLines).toEqual(['A', 'B']);
  });

  it('keeps Chiron in every panel by default, dropping it once chironVisible is false', () => {
    const withChiron: ChartData = { ...data, positions: [...data.positions, position(CHIRON, 200)] };
    const shown = chartSheetInput(withChiron);
    expect(shown.matrix.bodies.map((body) => body.key)).toEqual(['sun', 'moon', 'mars', 'chiron']);
    expect(shown.emphasis.bodies.map((body) => body.key)).toEqual(['sun', 'moon', 'mars', 'chiron']);
    expect(shown.strip.bodies.map((body) => body.key)).toEqual(['sun', 'moon', 'mars', 'chiron']);
    expect(shown.rings[0]?.bodies.map((body) => body.key)).toEqual(['sun', 'moon', 'mars', 'chiron']);

    const hidden = chartSheetInput(withChiron, [], 'Natal', { chironVisible: false });
    expect(hidden.matrix.bodies.map((body) => body.key)).toEqual(['sun', 'moon', 'mars']);
    expect(hidden.emphasis.bodies.map((body) => body.key)).toEqual(['sun', 'moon', 'mars']);
    expect(hidden.strip.bodies.map((body) => body.key)).toEqual(['sun', 'moon', 'mars']);
    expect(hidden.rings[0]?.bodies.map((body) => body.key)).toEqual(['sun', 'moon', 'mars']);
  });
});

describe('chartSheetMetaLines', () => {
  const moment: BirthMomentInput = {
    civil: { year: 1815, month: 12, day: 10, hour: 6, minute: 5, second: 0 },
    coordinates: { latitude: 51.5, longitude: -0.12 },
  };

  it('states the name, the civil date and time as entered, and the place', () => {
    expect(chartSheetMetaLines('Ada Lovelace', moment)).toEqual(['Ada Lovelace', '1815-12-10 06:05', '51.50°N 0.12°W']);
  });

  it('names the zone when the record overrides it', () => {
    expect(chartSheetMetaLines('Ada', { ...moment, zoneOverride: 'Europe/London' })[1]).toBe(
      '1815-12-10 06:05 (Europe/London)',
    );
  });

  it('says so when the offset was stated rather than looked up', () => {
    expect(chartSheetMetaLines('Ada', { ...moment, offsetOverrideMinutes: -75 })[1]).toBe(
      '1815-12-10 06:05 (stated offset)',
    );
  });

  it('marks a southern latitude and an eastern longitude by hemisphere', () => {
    expect(chartSheetMetaLines('Anon', { ...moment, coordinates: { latitude: -33.87, longitude: 151.21 } })[2]).toBe(
      '33.87°S 151.21°E',
    );
  });

  it('falls back to a generic title rather than an empty first line', () => {
    expect(chartSheetMetaLines('', moment)[0]).toBe('Chart');
  });
});
