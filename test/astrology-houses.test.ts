import { describe, expect, it } from 'vitest';
import { HOUSE_SYSTEMS, houseSystemByCode, houseSystemByKey } from '../src/astrology/houses.js';
import { EphemerisError } from '../src/ephemeris/types.js';
import { getEngine } from './engine-harness.js';

// A mid-latitude location, safely inside the domain where every system
// (including Placidus and Koch) is defined. Polar-latitude failure handling
// is #20's concern, not this registry's.
const AMSTERDAM = { latitude: 52.370216, longitude: 4.895168, altitude: 0 };

describe('the canonical house-system registry (#19)', () => {
  it('has no duplicate codes or keys', () => {
    expect(new Set(HOUSE_SYSTEMS.map((s) => s.code)).size).toBe(HOUSE_SYSTEMS.length);
    expect(new Set(HOUSE_SYSTEMS.map((s) => s.key)).size).toBe(HOUSE_SYSTEMS.length);
  });

  it('excludes E, the documented legacy alias of A ("equal")', () => {
    expect(houseSystemByCode('E')).toBeUndefined();
    expect(houseSystemByCode('A')?.key).toBe('equal');
  });

  it('round-trips through houseSystemByCode and houseSystemByKey', () => {
    for (const system of HOUSE_SYSTEMS) {
      expect(houseSystemByCode(system.code)).toBe(system);
      expect(houseSystemByKey(system.key)).toBe(system);
    }
  });

  it('computes cusps for every registered system, matching its declared cuspCount', async () => {
    const engine = await getEngine();
    const jd = await engine.julianDay(2000, 1, 1, 12);
    for (const system of HOUSE_SYSTEMS) {
      const houses = await engine.houses(jd, AMSTERDAM, system.code);
      // cusps[0] is unused padding (see engine.ts), so the array is one longer
      // than the number of houses.
      expect(houses.cusps, system.key).toHaveLength(system.cuspCount + 1);
      for (const cusp of houses.cusps.slice(1)) {
        expect(Number.isFinite(cusp), system.key).toBe(true);
        expect(cusp, system.key).toBeGreaterThanOrEqual(0);
        expect(cusp, system.key).toBeLessThan(360);
      }
    }
  });

  it('resolves a non-empty display name for every registered system', async () => {
    const engine = await getEngine();
    for (const system of HOUSE_SYSTEMS) {
      const name = await engine.houseSystemName(system.code);
      expect(typeof name, system.key).toBe('string');
      expect(name.length, system.key).toBeGreaterThan(0);
    }
  });

  it('agrees that A and E share a display name, confirming the alias', async () => {
    const engine = await getEngine();
    expect(await engine.houseSystemName('E')).toBe(await engine.houseSystemName('A'));
  });

  it('places the Ascendant at cusp 1 and the Midheaven at cusp 10 for quadrant systems', async () => {
    // Deliberately excludes 'equal': its cusp 10 is Ascendant+270 by
    // definition, not the Midheaven, so the two only coincide by coincidence.
    const engine = await getEngine();
    const jd = await engine.julianDay(2000, 1, 1, 12);
    for (const key of ['placidus', 'koch', 'regiomontanus', 'campanus', 'porphyry']) {
      const system = houseSystemByKey(key);
      if (!system) throw new Error(`missing house system: ${key}`);
      const houses = await engine.houses(jd, AMSTERDAM, system.code);
      expect(houses.cusps[1], key).toBeCloseTo(houses.ascendant, 9);
      expect(houses.cusps[10], key).toBeCloseTo(houses.midheaven, 9);
    }
  });
});

describe('polar-latitude house fallback (#20)', () => {
  // Placidus and Koch are undefined beyond roughly +/-66.5 degrees. Swiss
  // Ephemeris itself detects this and names Porphyry as its fallback; the
  // engine must retry with that system and say so rather than silently
  // returning cusps that look like Placidus but are not.
  const REYKJAVIK_ARCTIC = { latitude: 70, longitude: -8, altitude: 0 };
  const ANTARCTIC = { latitude: -70, longitude: -8, altitude: 0 };

  it('falls back to Porphyry for Placidus at 70N, with a warning naming both', async () => {
    const engine = await getEngine();
    const jd = await engine.julianDay(2000, 1, 1, 12);
    const houses = await engine.houses(jd, REYKJAVIK_ARCTIC, 'P');

    expect(houses.system).toBe('O');
    expect(houses.warning).toMatch(/'P'/);
    expect(houses.warning).toMatch(/70/);
    expect(houses.cusps).toHaveLength(13);
    expect(Number.isFinite(houses.cusps[1])).toBe(true);
  });

  it('falls back to Porphyry for Koch at 70N', async () => {
    const engine = await getEngine();
    const jd = await engine.julianDay(2000, 1, 1, 12);
    const houses = await engine.houses(jd, REYKJAVIK_ARCTIC, 'K');

    expect(houses.system).toBe('O');
    expect(houses.warning).toBeDefined();
  });

  it('falls back the same way in the southern polar circle', async () => {
    const engine = await getEngine();
    const jd = await engine.julianDay(2000, 1, 1, 12);
    const houses = await engine.houses(jd, ANTARCTIC, 'P');

    expect(houses.system).toBe('O');
    expect(houses.warning).toBeDefined();
  });

  it('never falls back below the polar circle', async () => {
    const engine = await getEngine();
    const jd = await engine.julianDay(2000, 1, 1, 12);
    const oslo = { latitude: 59.9, longitude: 10.75, altitude: 0 };
    const houses = await engine.houses(jd, oslo, 'P');

    expect(houses.system).toBe('P');
    expect(houses.warning).toBeUndefined();
  });

  it('does not fall back for a system unaffected by the polar circle', async () => {
    const engine = await getEngine();
    const jd = await engine.julianDay(2000, 1, 1, 12);
    const houses = await engine.houses(jd, REYKJAVIK_ARCTIC, 'O');

    expect(houses.system).toBe('O');
    expect(houses.warning).toBeUndefined();
  });
});

describe('Horizon house system degeneracy near the equator (#184)', () => {
  // Exact counterexample fast-check's property test ("house cusps wrap
  // monotonically forward and sum to 360 degrees (#37)") shrank to: UTC
  // 1801-02-06 03:00, house system 'H', latitude a hair below 0, longitude 0.
  // Verified directly against `swe_houses_ex2` (before any normalisation in
  // this codebase runs) that the raw cusps really do wind 11x around the
  // ecliptic there — clustered into two decreasing runs near 0 and 180
  // degrees rather than spread every ~30 degrees — rather than this being a
  // units/modulo-wrap bug on Astraya's side. There is no fallback house
  // system for this case (unlike Placidus/Koch above), so the engine throws
  // instead of silently returning cusps that don't actually divide the
  // ecliptic once around. Pinned here as a deterministic regression: the
  // property test's random seed only hits this case intermittently.
  it('throws rather than returning multi-winding cusps for the known counterexample', async () => {
    const engine = await getEngine();
    const jd = await engine.julianDay(1801, 2, 6, 3);
    const nearEquator = { latitude: -0.0000010000000000000002, longitude: 0, altitude: 0 };

    await expect(engine.houses(jd, nearEquator, 'H')).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(EphemerisError);
      expect((error as Error).message).toMatch(/'H'/);
      expect((error as Error).message).toMatch(/degenerate/);
      return true;
    });
  });

  it('still computes normally for the Horizon system away from the degenerate zone', async () => {
    const engine = await getEngine();
    const jd = await engine.julianDay(2000, 1, 1, 12);
    const houses = await engine.houses(jd, AMSTERDAM, 'H');

    expect(houses.system).toBe('H');
    expect(houses.warning).toBeUndefined();
    for (const cusp of houses.cusps.slice(1)) {
      expect(Number.isFinite(cusp)).toBe(true);
    }
  });
});
