/**
 * Equatorial coordinates and obliquity of the ecliptic (#32).
 *
 * `equatorial` and `obliquity` both existed on `PositionOptions`/were added to
 * `SwissEphemerisEngine` for declination work, but had no direct coverage —
 * this closes that gap the same way `ephemeris-position-options.test.ts` did
 * for the topocentric/true/heliocentric options.
 */
import { describe, expect, it } from 'vitest';
import { SE } from '../src/ephemeris/generated-constants.js';
import { getEngine } from './engine-harness.js';

const JD_2024 = 2_460_310.5; // 2024-01-01 00:00 UT

describe('equatorial positions (#32)', () => {
  it('returns declination in place of ecliptic latitude, differing measurably from it', async () => {
    const engine = await getEngine();
    const ecliptic = await engine.position(JD_2024, SE.SE_SUN);
    const equatorial = await engine.position(JD_2024, SE.SE_SUN, { equatorial: true });

    // The Sun sits on the ecliptic (latitude ~0) but has a non-trivial
    // declination in January — proof the flag actually swapped coordinate
    // systems rather than being silently ignored.
    expect(Math.abs(ecliptic.latitude)).toBeLessThan(0.01);
    expect(Math.abs(equatorial.latitude)).toBeGreaterThan(15);
  });

  it('gives the Sun a declination within the tropics', async () => {
    const engine = await getEngine();
    const obliquity = await engine.obliquity(JD_2024);
    const equatorial = await engine.position(JD_2024, SE.SE_SUN, { equatorial: true });

    // The Sun can never be more extreme than the obliquity itself — that is
    // the boundary "out of bounds" is measured against.
    expect(Math.abs(equatorial.latitude)).toBeLessThanOrEqual(obliquity + 1e-6);
  });
});

describe('obliquity (#32)', () => {
  it('is close to the well-known ~23.44 degree value', async () => {
    const engine = await getEngine();
    const obliquity = await engine.obliquity(JD_2024);
    expect(obliquity).toBeGreaterThan(23.3);
    expect(obliquity).toBeLessThan(23.5);
  });

  it('drifts slightly over centuries rather than being a hardcoded constant', async () => {
    const engine = await getEngine();
    const obliquity2024 = await engine.obliquity(JD_2024);
    const obliquity1900 = await engine.obliquity(2_415_020.5); // 1900-01-01
    expect(obliquity2024).not.toBe(obliquity1900);
  });
});
