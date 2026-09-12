/**
 * Unit tests for the pure harmonic/Varga math (#170) — no ephemeris needed, since
 * `harmonicLongitude`/`harmonicHouses` are plain arithmetic over longitudes already computed.
 */
import { describe, expect, it } from 'vitest';
import { harmonicHouses, harmonicLongitude, harmonicPosition, VARGA_PRESETS } from '../src/astrology/harmonics.js';
import { signOf } from '../src/astrology/signs.js';
import type { BodyPosition, HousePositions } from '../src/ephemeris/types.js';

describe('harmonicLongitude (#170)', () => {
  it('multiplies and wraps back into 0-360', () => {
    expect(harmonicLongitude(30, 9)).toBe(270);
    expect(harmonicLongitude(45, 9)).toBeCloseTo(45, 9); // 405 mod 360
    expect(harmonicLongitude(0, 5)).toBe(0);
  });

  it('is always in [0, 360)', () => {
    for (let lon = 0; lon < 360; lon += 17) {
      for (const n of [1, 5, 7, 9, 10, 12]) {
        const value = harmonicLongitude(lon, n);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(360);
      }
    }
  });

  it('n=1 is the identity', () => {
    expect(harmonicLongitude(123.456, 1)).toBeCloseTo(123.456, 9);
  });
});

describe('D9 Navamsha equivalence (#170)', () => {
  // The classical Parashari rule: movable signs count navamshas from themselves; fixed signs
  // from the 9th sign onward; mutable signs from the 5th sign onward. This module's doc comment
  // claims the plain `longitude * 9` rule reproduces this exactly — checked here at a boundary
  // case for each of the three modalities.
  it('starts a movable sign (Aries) counting from itself', () => {
    expect(signOf(harmonicLongitude(0, 9)).name).toBe('Aries');
    expect(signOf(harmonicLongitude(15, 9)).name).toBe('Leo'); // 4 signs on from Aries
  });

  it('starts a fixed sign (Taurus) counting from the 9th sign onward', () => {
    expect(signOf(harmonicLongitude(30, 9)).name).toBe('Capricorn');
  });

  it('starts a mutable sign (Gemini) counting from the 5th sign onward', () => {
    expect(signOf(harmonicLongitude(60, 9)).name).toBe('Libra');
  });
});

describe('D10 Dashamsha divergence (#170)', () => {
  // Documented in harmonics.ts: this module deliberately does not implement the classical
  // odd/even sign restart, so an even natal sign (Taurus) diverges from that classical result.
  it('does not apply the classical odd/even restart for an even sign (Taurus)', () => {
    // Classical odd/even rule would give Capricorn (9th sign from Taurus) here; the continuous
    // rule this module uses gives Aquarius instead — the documented simplification.
    expect(signOf(harmonicLongitude(30, 10)).name).toBe('Aquarius');
  });

  it('matches the classical rule for an odd sign (Aries), where both rules agree', () => {
    expect(signOf(harmonicLongitude(0, 10)).name).toBe('Aries');
  });
});

describe('harmonicPosition (#170)', () => {
  const natal: BodyPosition = {
    body: 0,
    longitude: 100,
    latitude: 1.5,
    distance: 0.9,
    longitudeSpeed: -0.3,
    latitudeSpeed: 0.01,
    distanceSpeed: 0.001,
    retrograde: true,
  };

  it('transforms only longitude, carrying every other field over unchanged', () => {
    const result = harmonicPosition(natal, 9);
    expect(result.longitude).toBe(harmonicLongitude(100, 9));
    expect(result.latitude).toBe(natal.latitude);
    expect(result.distance).toBe(natal.distance);
    expect(result.longitudeSpeed).toBe(natal.longitudeSpeed);
    expect(result.retrograde).toBe(natal.retrograde);
  });
});

describe('harmonicHouses (#170)', () => {
  const natalHouses: HousePositions = {
    cusps: [Number.NaN, 10, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340],
    ascendant: 10,
    midheaven: 280,
    armc: 275,
    vertex: 200,
    equatorialAscendant: 12,
    coAscendantKoch: 15,
    coAscendantMunkasey: 20,
    polarAscendant: 25,
    system: 'P',
  };

  it('builds whole-sign cusps from the transformed Ascendant', () => {
    const houses = harmonicHouses(natalHouses, 9);
    expect(houses.system).toBe('W');
    expect(houses.ascendant).toBe(harmonicLongitude(10, 9));

    const baseSign = signOf(houses.ascendant).index;
    for (let house = 1; house <= 12; house++) {
      expect(houses.cusps[house]).toBe(((baseSign + house - 1) % 12) * 30);
    }
  });

  it('transforms every other angle the same way as a body longitude', () => {
    const houses = harmonicHouses(natalHouses, 5);
    expect(houses.midheaven).toBe(harmonicLongitude(280, 5));
    expect(houses.armc).toBe(harmonicLongitude(275, 5));
    expect(houses.vertex).toBe(harmonicLongitude(200, 5));
    expect(houses.equatorialAscendant).toBe(harmonicLongitude(12, 5));
    expect(houses.coAscendantKoch).toBe(harmonicLongitude(15, 5));
    expect(houses.coAscendantMunkasey).toBe(harmonicLongitude(20, 5));
    expect(houses.polarAscendant).toBe(harmonicLongitude(25, 5));
  });

  it('n=1 lands whole-sign house 1 on the natal Ascendant’s own sign', () => {
    const houses = harmonicHouses(natalHouses, 1);
    expect(houses.cusps[1]).toBe(signOf(natalHouses.ascendant).index * 30);
  });
});

describe('VARGA_PRESETS (#170)', () => {
  it('includes D1, D9 and D10 at minimum, per the issue', () => {
    const keys = VARGA_PRESETS.map((preset) => preset.key);
    expect(keys).toContain('D1');
    expect(keys).toContain('D9');
    expect(keys).toContain('D10');
  });

  it('gives every preset a positive integer n', () => {
    for (const preset of VARGA_PRESETS) {
      expect(Number.isInteger(preset.n)).toBe(true);
      expect(preset.n).toBeGreaterThan(0);
    }
  });
});
