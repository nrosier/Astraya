import { describe, expect, it } from 'vitest';
import { AYANAMSAS, ayanamsaByKey, ayanamsaById } from '../src/astrology/ayanamsas.js';
import { SE } from '../src/ephemeris/generated-constants.js';
import { getEngine } from './engine-harness.js';

describe('the canonical ayanamsa registry (#21)', () => {
  it('has no duplicate ids or keys', () => {
    expect(new Set(AYANAMSAS.map((a) => a.id)).size).toBe(AYANAMSAS.length);
    expect(new Set(AYANAMSAS.map((a) => a.key)).size).toBe(AYANAMSAS.length);
  });

  it('covers every predefined sidereal mode and excludes the custom one', () => {
    expect(AYANAMSAS).toHaveLength(SE.SE_NSIDM_PREDEF);
    expect(AYANAMSAS.some((a) => a.id === SE.SE_SIDM_USER)).toBe(false);
  });

  it('round-trips through ayanamsaById and ayanamsaByKey', () => {
    for (const ayanamsa of AYANAMSAS) {
      expect(ayanamsaById(ayanamsa.id)).toBe(ayanamsa);
      expect(ayanamsaByKey(ayanamsa.key)).toBe(ayanamsa);
    }
  });

  it('resolves a non-empty display name for every registered mode', async () => {
    const engine = await getEngine();
    for (const ayanamsa of AYANAMSAS) {
      const name = await engine.ayanamsaName(ayanamsa.id);
      expect(typeof name, ayanamsa.key).toBe('string');
      expect(name.length, ayanamsa.key).toBeGreaterThan(0);
    }
  });

  it('agrees with generated-constants on a few well-known modes', () => {
    expect(ayanamsaByKey('lahiri')?.id).toBe(SE.SE_SIDM_LAHIRI);
    expect(ayanamsaByKey('faganBradley')?.id).toBe(SE.SE_SIDM_FAGAN_BRADLEY);
    expect(ayanamsaByKey('krishnamurti')?.id).toBe(SE.SE_SIDM_KRISHNAMURTI);
    expect(ayanamsaByKey('trueCitra')?.id).toBe(SE.SE_SIDM_TRUE_CITRA);
  });

  it('holds sidereal === tropical - ayanamsa for every registered mode', async () => {
    const engine = await getEngine();
    const jd = await engine.julianDay(2000, 1, 1, 12);
    const tropical = await engine.position(jd, SE.SE_SUN);

    for (const { id, key } of AYANAMSAS) {
      const [sidereal, ayanamsa] = await Promise.all([
        engine.position(jd, SE.SE_SUN, { zodiac: { kind: 'sidereal', ayanamsa: id } }),
        engine.ayanamsa(jd, id),
      ]);
      const delta = ((tropical.longitude - sidereal.longitude + 540) % 360) - 180;
      // Both sides are angles, so compare them wrapped rather than by raw value:
      // the ayanamsa itself is not normalised to [0, 360) (e.g. galcentCochrane
      // reports -3.16 deg, equivalent to 356.84 deg).
      const wrappedDifference = ((delta - ayanamsa + 540) % 360) - 180;
      expect(wrappedDifference, key).toBeCloseTo(0, 5);
    }
  });
});
