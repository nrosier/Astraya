import { describe, expect, it } from 'vitest';
import { HOUSE_SYSTEMS, houseSystemByCode, houseSystemByKey } from '../src/astrology/houses.js';
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
