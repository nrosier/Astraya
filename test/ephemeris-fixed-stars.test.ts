/**
 * Fixed star positions and magnitudes via the engine (#33).
 *
 * Reference values are loose, published facts about Regulus (Alpha Leonis)
 * rather than a golden fixture: its ecliptic longitude was close to 29°50'
 * Leo (149.8°) at J2000 and precesses about 0.014°/year, and its visual
 * magnitude is catalogued at ~1.35. The bounds below are wide enough to be
 * robust to which epoch is used while still catching a badly wrong lookup
 * (wrong star, wrong coordinate system, or a stale/corrupt sefstars.txt).
 */
import { describe, expect, it } from 'vitest';
import { EphemerisError } from '../src/ephemeris/types.js';
import { SE } from '../src/ephemeris/generated-constants.js';
import { getEngine } from './engine-harness.js';

const JD_2024 = 2_460_310.5; // 2024-01-01 00:00 UT

describe('fixedStar (#33)', () => {
  it('resolves a known star by name to a plausible position', async () => {
    const engine = await getEngine();
    const regulus = await engine.fixedStar(JD_2024, 'Regulus');
    expect(regulus.name.toLowerCase()).toContain('regulus');
    expect(regulus.longitude).toBeGreaterThan(149);
    expect(regulus.longitude).toBeLessThan(152);
    expect(Math.abs(regulus.latitude)).toBeLessThan(1); // Regulus sits close to the ecliptic
  });

  it('shifts by the ayanamsa under a sidereal zodiac, like any other point', async () => {
    const engine = await getEngine();
    const tropical = await engine.fixedStar(JD_2024, 'Regulus');
    const sidereal = await engine.fixedStar(JD_2024, 'Regulus', {
      zodiac: { kind: 'sidereal', ayanamsa: SE.SE_SIDM_LAHIRI },
    });
    const ayanamsa = await engine.ayanamsa(JD_2024, SE.SE_SIDM_LAHIRI);
    expect(tropical.longitude - sidereal.longitude).toBeCloseTo(ayanamsa, 6);
  });

  it('returns equatorial coordinates when asked, differing from ecliptic', async () => {
    const engine = await getEngine();
    const ecliptic = await engine.fixedStar(JD_2024, 'Regulus');
    const equatorial = await engine.fixedStar(JD_2024, 'Regulus', { equatorial: true });
    expect(equatorial.longitude).not.toBeCloseTo(ecliptic.longitude, 1);
  });

  it('throws an EphemerisError for an unknown star name', async () => {
    const engine = await getEngine();
    await expect(engine.fixedStar(JD_2024, 'NotARealStarName')).rejects.toThrow(EphemerisError);
  });
});

describe('fixedStarMagnitude (#33)', () => {
  it('returns Regulus at its catalogued visual magnitude', async () => {
    const engine = await getEngine();
    const magnitude = await engine.fixedStarMagnitude('Regulus');
    expect(magnitude.name.toLowerCase()).toContain('regulus');
    expect(magnitude.magnitude).toBeGreaterThan(1);
    expect(magnitude.magnitude).toBeLessThan(1.7);
  });

  it('throws an EphemerisError for an unknown star name', async () => {
    const engine = await getEngine();
    await expect(engine.fixedStarMagnitude('NotARealStarName')).rejects.toThrow(EphemerisError);
  });
});
