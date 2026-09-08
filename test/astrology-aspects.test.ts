import { describe, expect, it } from 'vitest';
import {
  ASPECTS,
  DEFAULT_ORB_CONFIG,
  angularSeparation,
  aspectByKey,
  findAspects,
  matchAspect,
  orbFor,
  type AspectSubject,
} from '../src/astrology/aspects.js';
import type { BodyPosition } from '../src/ephemeris/types.js';

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
  it('widens every aspect by the luminary bonus when either body is a luminary', () => {
    for (const aspect of ASPECTS) {
      const base = orbFor(aspect.key, 'planet', 'planet');
      expect(orbFor(aspect.key, 'luminary', 'planet')).toBe(base + DEFAULT_ORB_CONFIG.luminaryBonus);
      expect(orbFor(aspect.key, 'planet', 'luminary')).toBe(base + DEFAULT_ORB_CONFIG.luminaryBonus);
      expect(orbFor(aspect.key, 'luminary', 'luminary')).toBe(base + DEFAULT_ORB_CONFIG.luminaryBonus);
    }
  });

  it('is fully overridable via a custom config', () => {
    const config = { baseOrbs: { conjunction: 1 }, luminaryBonus: 10 };
    expect(orbFor('conjunction', 'planet', 'planet', config)).toBe(1);
    expect(orbFor('conjunction', 'luminary', 'asteroid', config)).toBe(11);
  });

  it('rejects an aspect key missing from the config', () => {
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
    // orb (10) and semisextile's (25), but conjunction's orb of 10 is smaller
    // than semisextile's orb of 20, so conjunction must win.
    const config = { baseOrbs: { conjunction: 15, semisextile: 25 }, luminaryBonus: 0 };
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

  it('only considers aspects present in a partial config, even at an exact hit', () => {
    const config = { baseOrbs: { sextile: 5 }, luminaryBonus: 0 };
    expect(matchAspect(position(0), 'planet', position(0), 'planet', config)).toBeUndefined();
    expect(matchAspect(position(0), 'planet', position(60), 'planet', config)?.aspect.key).toBe('sextile');
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
      const match = matchAspect(a, 'planet', b, 'planet', {
        baseOrbs: Object.fromEntries(ASPECTS.map((asp) => [asp.key, 20])),
        luminaryBonus: 0,
      });
      if (!match) continue;

      const later = matchAspect(
        position(lonA + speedA * dt, speedA),
        'planet',
        position(lonB + speedB * dt, speedB),
        'planet',
        { baseOrbs: Object.fromEntries(ASPECTS.map((asp) => [asp.key, 20])), luminaryBonus: 0 },
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
