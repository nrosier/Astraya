import { describe, expect, it } from 'vitest';
import {
  ASPECTS,
  DEFAULT_ORB_CONFIG,
  angularSeparation,
  aspectByKey,
  findAspects,
  findCrossAspects,
  fixedSubjects,
  matchAspect,
  orbFor,
  subjectsFrom,
  type AspectSubject,
} from '../src/astrology/aspects.js';
import type { BodyCategory } from '../src/astrology/bodies.js';
import type { BodyId, BodyPosition } from '../src/ephemeris/types.js';

function position(longitude: number, longitudeSpeed = 1): BodyPosition {
  return {
    body: 0,
    longitude,
    latitude: 0,
    distance: 1,
    longitudeSpeed,
    latitudeSpeed: 0,
    distanceSpeed: 0,
    retrograde: longitudeSpeed < 0,
  };
}

describe('the canonical aspect registry (#24)', () => {
  it('has 11 distinct aspects with distinct angles in [0, 180]', () => {
    expect(ASPECTS).toHaveLength(11);
    expect(new Set(ASPECTS.map((a) => a.key)).size).toBe(11);
    expect(new Set(ASPECTS.map((a) => a.angle)).size).toBe(11);
    for (const aspect of ASPECTS) {
      expect(aspect.angle).toBeGreaterThanOrEqual(0);
      expect(aspect.angle).toBeLessThanOrEqual(180);
    }
  });

  it('includes the five Ptolemaic aspects as major', () => {
    for (const key of ['conjunction', 'sextile', 'square', 'trine', 'opposition']) {
      expect(aspectByKey(key)?.family).toBe('major');
    }
  });

  it('includes the quintile series and the other named minors', () => {
    for (const key of ['semisextile', 'semisquare', 'sesquiquadrate', 'quincunx', 'quintile', 'biquintile']) {
      expect(aspectByKey(key)?.family, key).toBe('minor');
    }
    expect(aspectByKey('quintile')?.angle).toBe(72);
    expect(aspectByKey('biquintile')?.angle).toBe(144);
  });

  it('round-trips through aspectByKey', () => {
    for (const aspect of ASPECTS) {
      expect(aspectByKey(aspect.key)).toBe(aspect);
    }
  });
});

describe('orbFor (#24)', () => {
  it('gives the four non-sextile majors the major-tier orb and bonus', () => {
    for (const key of ['conjunction', 'square', 'trine', 'opposition']) {
      expect(orbFor(key, 'planet', 'planet')).toBe(DEFAULT_ORB_CONFIG.majorOrb.base);
      expect(orbFor(key, 'luminary', 'planet')).toBe(
        DEFAULT_ORB_CONFIG.majorOrb.base + DEFAULT_ORB_CONFIG.majorOrb.luminaryBonus,
      );
    }
  });

  it('gives sextile its own, smaller tier and bonus', () => {
    expect(orbFor('sextile', 'planet', 'planet')).toBe(DEFAULT_ORB_CONFIG.sextileOrb.base);
    expect(orbFor('sextile', 'luminary', 'planet')).toBe(
      DEFAULT_ORB_CONFIG.sextileOrb.base + DEFAULT_ORB_CONFIG.sextileOrb.luminaryBonus,
    );
  });

  it('gives every minor aspect the same flat orb, unaffected by a luminary', () => {
    for (const key of ['semisextile', 'semisquare', 'quintile', 'sesquiquadrate', 'biquintile', 'quincunx']) {
      expect(orbFor(key, 'planet', 'planet')).toBe(DEFAULT_ORB_CONFIG.minorOrb);
      expect(orbFor(key, 'luminary', 'luminary')).toBe(DEFAULT_ORB_CONFIG.minorOrb);
    }
  });

  it('scales every tier by the configured percentage', () => {
    const config = { ...DEFAULT_ORB_CONFIG, scalePercent: 50 };
    expect(orbFor('square', 'planet', 'planet', config)).toBeCloseTo(DEFAULT_ORB_CONFIG.majorOrb.base * 1.5, 9);
    expect(orbFor('sextile', 'planet', 'planet', config)).toBeCloseTo(DEFAULT_ORB_CONFIG.sextileOrb.base * 1.5, 9);
    expect(orbFor('quincunx', 'planet', 'planet', config)).toBeCloseTo(DEFAULT_ORB_CONFIG.minorOrb * 1.5, 9);
  });

  it('is fully overridable via a custom config', () => {
    const config = {
      majorOrb: { base: 1, luminaryBonus: 10 },
      sextileOrb: { base: 0, luminaryBonus: 0 },
      minorOrb: 0,
      scalePercent: 0,
      enabledMinorAspects: [],
    };
    expect(orbFor('conjunction', 'planet', 'planet', config)).toBe(1);
    expect(orbFor('conjunction', 'luminary', 'asteroid', config)).toBe(11);
  });

  it('rejects an aspect key that is not in the registry at all', () => {
    expect(() => orbFor('nonsense', 'planet', 'planet')).toThrow(RangeError);
  });
});

describe('angularSeparation (#24)', () => {
  it('is symmetric and stays within [0, 180]', () => {
    for (let a = 0; a < 360; a += 37) {
      for (let b = 0; b < 360; b += 53) {
        const sep = angularSeparation(a, b);
        expect(sep).toBeGreaterThanOrEqual(0);
        expect(sep).toBeLessThanOrEqual(180);
        expect(angularSeparation(b, a)).toBeCloseTo(sep, 9);
      }
    }
  });

  it('wraps correctly across the 0/360 boundary', () => {
    expect(angularSeparation(1, 359)).toBeCloseTo(2, 9);
    expect(angularSeparation(0, 180)).toBeCloseTo(180, 9);
  });
});

describe('matchAspect (#24)', () => {
  it('finds an exact conjunction with zero orb', () => {
    const match = matchAspect(position(10), 'planet', position(10), 'planet');
    expect(match?.aspect.key).toBe('conjunction');
    expect(match?.orb).toBe(0);
    expect(match?.separation).toBe(0);
  });

  it('finds an exact opposition', () => {
    const match = matchAspect(position(10), 'planet', position(190), 'planet');
    expect(match?.aspect.key).toBe('opposition');
    expect(match?.orb).toBeCloseTo(0, 9);
  });

  it('reports no aspect once separation exceeds every configured orb', () => {
    // 100 degrees sits between square's widest reach (90 + 7 = 97) and
    // trine's (120 - 7 = 113), and every other aspect is further still.
    const match = matchAspect(position(0), 'planet', position(100), 'planet');
    expect(match).toBeUndefined();
  });

  it('picks the smaller orb when a separation falls within two aspects at once', () => {
    // A deliberately overlapping config: 10 degrees is within conjunction's
    // orb (15) and semisextile's (20), but conjunction's orb of 10 is smaller
    // than semisextile's orb of 20, so conjunction must win.
    const config = {
      majorOrb: { base: 15, luminaryBonus: 0 },
      sextileOrb: { base: 0, luminaryBonus: 0 },
      minorOrb: 20,
      scalePercent: 0,
      enabledMinorAspects: ['semisextile'],
    };
    const match = matchAspect(position(0), 'planet', position(10), 'planet', config);
    expect(match?.aspect.key).toBe('conjunction');
    expect(match?.orb).toBeCloseTo(10, 9);
  });

  it('widens the orb for a luminary and rejects the same separation for two planets', () => {
    // 98 degrees is outside square's plain 7-degree orb (max reach 97) but
    // within reach once either body is a luminary (max reach 99).
    const withoutLuminary = matchAspect(position(0), 'planet', position(98), 'planet');
    expect(withoutLuminary).toBeUndefined();

    const withLuminary = matchAspect(position(0), 'luminary', position(98), 'planet');
    expect(withLuminary?.aspect.key).toBe('square');
    expect(withLuminary?.orb).toBeCloseTo(8, 9);
  });

  it('only considers minor aspects present in enabledMinorAspects, even at an exact hit', () => {
    expect(matchAspect(position(0), 'planet', position(150), 'planet')).toBeUndefined(); // quincunx, disabled by default
    const config = { ...DEFAULT_ORB_CONFIG, enabledMinorAspects: ['quincunx'] };
    expect(matchAspect(position(0), 'planet', position(150), 'planet', config)?.aspect.key).toBe('quincunx');
  });

  it('marks a fast body approaching an exact square as applying', () => {
    // Sun at 0 deg/day-ish, Moon closing in on the square from below.
    const sun = position(0, 1);
    const moon = position(87, 13);
    const match = matchAspect(sun, 'luminary', moon, 'luminary');
    expect(match?.aspect.key).toBe('square');
    expect(match?.applying).toBe(true);
  });

  it('marks a body moving away from a square as separating', () => {
    const sun = position(0, 1);
    const mars = position(87, 0.5);
    const match = matchAspect(sun, 'luminary', mars, 'planet');
    expect(match?.aspect.key).toBe('square');
    expect(match?.applying).toBe(false);
  });

  it('agrees with a finite-difference check of the orb shrinking or growing', () => {
    const dt = 1 / 24 / 60; // one minute, small relative to any real body's speed
    const wideConfig = {
      majorOrb: { base: 20, luminaryBonus: 0 },
      sextileOrb: { base: 20, luminaryBonus: 0 },
      minorOrb: 20,
      scalePercent: 0,
      enabledMinorAspects: ASPECTS.filter((asp) => asp.family === 'minor').map((asp) => asp.key),
    };
    const cases: [number, number, number, number][] = [
      [0, 1, 87, 13],
      [0, 1, 87, 0.5],
      [10, 0.5, 205, -0.3],
      [350, 1, 40, 2],
      [0, 1, 178, 1.02],
    ];
    for (const [lonA, speedA, lonB, speedB] of cases) {
      const a = position(lonA, speedA);
      const b = position(lonB, speedB);
      const match = matchAspect(a, 'planet', b, 'planet', wideConfig);
      if (!match) continue;

      const later = matchAspect(
        position(lonA + speedA * dt, speedA),
        'planet',
        position(lonB + speedB * dt, speedB),
        'planet',
        wideConfig,
      );
      const laterOrb = later?.aspect.key === match.aspect.key ? later.orb : 180;

      if (match.orb > 1e-6) {
        expect(match.applying, `${lonA}/${speedA} vs ${lonB}/${speedB}`).toBe(laterOrb < match.orb);
      }
    }
  });
});

describe('findAspects (#24)', () => {
  function subject(body: number, longitude: number, longitudeSpeed = 1): AspectSubject {
    return { body, position: position(longitude, longitudeSpeed), category: 'planet' };
  }

  it('returns one entry per in-orb pair, none for a pair out of orb', () => {
    const subjects = [subject(1, 0), subject(2, 60), subject(3, 200)];
    const aspects = findAspects(subjects);
    expect(aspects).toHaveLength(1);
    expect(aspects[0]?.bodyA).toBe(1);
    expect(aspects[0]?.bodyB).toBe(2);
    expect(aspects[0]?.aspect.key).toBe('sextile');
  });

  it('checks every pair exactly once among more than two bodies', () => {
    const subjects = [subject(1, 0), subject(2, 90), subject(3, 180), subject(4, 270)];
    const aspects = findAspects(subjects);
    const pairs = aspects.map((a) => [a.bodyA, a.bodyB].sort().join('-'));
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(aspects).toHaveLength(6); // squares/oppositions all round: every pair is in orb
  });

  it('returns nothing for a single subject or an empty list', () => {
    expect(findAspects([])).toEqual([]);
    expect(findAspects([subject(1, 0)])).toEqual([]);
  });
});

describe('findCrossAspects (#47)', () => {
  function subject(body: number, longitude: number, longitudeSpeed = 1): AspectSubject {
    return { body, position: position(longitude, longitudeSpeed), category: 'planet' };
  }

  it('checks every pairing between two lists, not only i<j within one', () => {
    const listA = [subject(1, 0), subject(2, 90)];
    const listB = [subject(10, 180), subject(11, 270)];
    const aspects = findCrossAspects(listA, listB);
    const pairs = aspects.map((a) => `${a.bodyA}-${a.bodyB}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    // 1-10 opposition, 1-11 square, 2-10 square, 2-11 opposition: all four pairings are in orb.
    expect(aspects).toHaveLength(4);
  });

  it('never pairs a body against itself within the same list', () => {
    const listA = [subject(1, 0)];
    expect(findCrossAspects(listA, listA)).toHaveLength(1); // 1 vs 1: a conjunction with itself, not a self-skip
  });

  it('returns nothing when either list is empty', () => {
    expect(findCrossAspects([], [subject(1, 0)])).toEqual([]);
    expect(findCrossAspects([subject(1, 0)], [])).toEqual([]);
  });
});

describe('subjectsFrom and fixedSubjects (#51)', () => {
  const categoryOf = (body: BodyId): BodyCategory => (body === 0 ? 'luminary' : 'planet');

  it('subjectsFrom carries each position through with its own real speed', () => {
    const positions = [position(10, 1), { ...position(60, 13), body: 1 }];
    const subjects = subjectsFrom(positions, categoryOf);

    expect(subjects).toHaveLength(2);
    expect(subjects[0]).toEqual({ body: 0, category: 'luminary', position: positions[0] });
    expect(subjects[1]).toEqual({ body: 1, category: 'planet', position: positions[1] });
  });

  it('fixedSubjects zeroes longitude and latitude speed but keeps the longitude', () => {
    const positions = [position(10, 1)];
    const [subject] = fixedSubjects(positions, categoryOf);

    expect(subject?.position.longitude).toBe(10);
    expect(subject?.position.longitudeSpeed).toBe(0);
    expect(subject?.position.latitudeSpeed).toBe(0);
  });

  it('a moving side applies toward a fixed side the same way a real chart-to-chart contact would', () => {
    // A fast body at 87 deg/1 closing on a fixed square at 90 (0 + 90): with
    // the fixed side's speed zeroed, applying depends only on the mover.
    const moving = subjectsFrom([{ ...position(87, 13), body: 1 }], categoryOf);
    const fixed = fixedSubjects([position(0, 1)], categoryOf);
    const [aspect] = findCrossAspects(moving, fixed);

    expect(aspect?.aspect.key).toBe('square');
    expect(aspect?.applying).toBe(true);
  });
});
