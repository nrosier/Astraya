/**
 * Coverage for `PositionOptions` fields beyond the tropical/sidereal zodiac
 * choice (#23): topocentric observers, true-vs-apparent positions, and
 * heliocentric positions. These have existed on `SwissEphemerisEngine` since
 * earlier work but were never exercised by a test — this file closes that gap
 * as well as adding the heliocentric option itself.
 */
import { describe, expect, it } from 'vitest';
import { SE } from '../src/ephemeris/generated-constants.js';
import { EphemerisError } from '../src/ephemeris/types.js';
import { arcsecondsBetween, getEngine } from './engine-harness.js';

const JD_2024 = 2_460_310.5; // 2024-01-01 00:00 UT
const AMSTERDAM = { latitude: 52.370216, longitude: 4.895168, altitude: 0 };

describe('topocentric positions (#23)', () => {
  it('differs measurably from geocentric for the Moon, the closest body', async () => {
    const engine = await getEngine();
    const geocentric = await engine.position(JD_2024, SE.SE_MOON);
    const topocentric = await engine.position(JD_2024, SE.SE_MOON, { observer: AMSTERDAM });

    // Lunar parallax is on the order of a degree — any plausible measurement
    // error is nowhere near this, so a generous arcsecond floor still proves
    // the observer was actually applied rather than silently ignored.
    expect(arcsecondsBetween(geocentric.longitude, topocentric.longitude)).toBeGreaterThan(60);
  });

  it('varies with the observer', async () => {
    const engine = await getEngine();
    const here = await engine.position(JD_2024, SE.SE_MOON, { observer: AMSTERDAM });
    const antipodal = await engine.position(JD_2024, SE.SE_MOON, {
      observer: { latitude: -AMSTERDAM.latitude, longitude: AMSTERDAM.longitude + 180, altitude: 0 },
    });
    expect(arcsecondsBetween(here.longitude, antipodal.longitude)).toBeGreaterThan(60);
  });
});

describe('true vs apparent positions (#23)', () => {
  it('differs from the default apparent position by a light-time/aberration-sized amount', async () => {
    const engine = await getEngine();
    const apparent = await engine.position(JD_2024, SE.SE_MERCURY);
    const trueposition = await engine.position(JD_2024, SE.SE_MERCURY, { truePositions: true });

    const delta = arcsecondsBetween(apparent.longitude, trueposition.longitude);
    // Light-time + annual aberration for an inner planet is a few arcseconds,
    // not degrees and not zero — this pins the flag actually taking effect.
    expect(delta).toBeGreaterThan(0.1);
    expect(delta).toBeLessThan(30);
  });
});

describe('heliocentric positions (#23)', () => {
  it('places heliocentric Earth opposite geocentric Sun, to sub-arcsecond precision', async () => {
    const engine = await getEngine();
    const geocentricSun = await engine.position(JD_2024, SE.SE_SUN);
    const heliocentricEarth = await engine.position(JD_2024, SE.SE_EARTH, { heliocentric: true });

    // Both a geometric identity and a check that the flag was really applied
    // rather than silently dropped back to geocentric.
    const oppositeOfEarth = (heliocentricEarth.longitude + 180) % 360;
    expect(arcsecondsBetween(geocentricSun.longitude, oppositeOfEarth)).toBeLessThan(0.01);
  });

  it('differs from the geocentric position for an inner planet', async () => {
    const engine = await getEngine();
    const geocentric = await engine.position(JD_2024, SE.SE_MERCURY);
    const heliocentric = await engine.position(JD_2024, SE.SE_MERCURY, { heliocentric: true });
    expect(arcsecondsBetween(geocentric.longitude, heliocentric.longitude)).toBeGreaterThan(3600);
  });

  it('refuses the Sun itself rather than returning the (0, 0) the library reports for it', async () => {
    const engine = await getEngine();
    await expect(engine.position(JD_2024, SE.SE_SUN, { heliocentric: true })).rejects.toThrow(EphemerisError);
  });

  it('refuses to combine with a topocentric observer rather than silently dropping it', async () => {
    // Verified empirically: sweph-wasm accepts both flags together but the
    // result is indistinguishable from topocentric-only, i.e. it silently
    // drops SEFLG_HELCTR. That is exactly the kind of quietly-wrong answer
    // this project refuses to hand back, so the engine rejects the combination.
    const engine = await getEngine();
    await expect(engine.position(JD_2024, SE.SE_MERCURY, { heliocentric: true, observer: AMSTERDAM })).rejects.toThrow(
      /mutually exclusive/,
    );
  });
});
