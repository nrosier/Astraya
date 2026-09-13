/**
 * `swe_azalt` binding (#171): azimuth/altitude of a point as seen from a place.
 *
 * `azimuthAltitude` is the engine-boundary primitive Local Space lines are built
 * on (`src/domain/astrocartography.ts`) — no hand-rolled hour-angle trig anywhere
 * in this app, per `docs/adr/0001-swiss-ephemeris-as-the-engine.md`.
 */
import { describe, expect, it } from 'vitest';
import { SE } from '../src/ephemeris/generated-constants.js';
import type { GeoPosition } from '../src/ephemeris/types.js';
import { getEngine } from './engine-harness.js';

const JD_2024 = 2_460_310.5; // 2024-01-01 00:00 UT
const LONDON: GeoPosition = { latitude: 51.5074, longitude: -0.1278, altitude: 0 };

describe('azimuthAltitude (#171)', () => {
  it('gives the culminating point of the ecliptic (the MC) a due-south azimuth', async () => {
    const engine = await getEngine();
    const houses = await engine.houses(JD_2024, LONDON, 'P');
    // A point on the ecliptic (latitude 0) at the MC's own longitude is, by
    // definition, the point currently on the local meridian — its hour angle is
    // exactly 0. At a mid-northern latitude with a within-the-tropics
    // declination, that means due south: an exact geometric check, not an
    // approximation of solar timing.
    const horizontal = await engine.azimuthAltitude(JD_2024, { longitude: houses.midheaven, latitude: 0 }, LONDON);
    expect(horizontal.azimuth).toBeCloseTo(180, 0);
  });

  it('agrees between ecliptic and equatorial input for the same point', async () => {
    const engine = await getEngine();
    const ecliptic = await engine.position(JD_2024, SE.SE_SUN);
    const equatorial = await engine.position(JD_2024, SE.SE_SUN, { equatorial: true });

    const viaEcliptic = await engine.azimuthAltitude(
      JD_2024,
      { longitude: ecliptic.longitude, latitude: ecliptic.latitude },
      LONDON,
    );
    const viaEquatorial = await engine.azimuthAltitude(
      JD_2024,
      { longitude: equatorial.longitude, latitude: equatorial.latitude },
      LONDON,
      { equatorial: true },
    );

    expect(viaEquatorial.azimuth).toBeCloseTo(viaEcliptic.azimuth, 3);
    expect(viaEquatorial.altitude).toBeCloseTo(viaEcliptic.altitude, 3);
  });

  // Local noon at London's longitude (near 0°), so the Sun is above the horizon —
  // low enough in January that refraction's effect on apparentAltitude is easy
  // to see, but not so low it never rises.
  const JD_LONDON_NOON = JD_2024 + 0.5;

  it('never changes true altitude when pressure/temperature options vary, only apparentAltitude', async () => {
    const engine = await getEngine();
    const sun = await engine.position(JD_LONDON_NOON, SE.SE_SUN);
    const auto = await engine.azimuthAltitude(JD_LONDON_NOON, sun, LONDON);
    const explicit = await engine.azimuthAltitude(JD_LONDON_NOON, sun, LONDON, {
      pressureHPa: 1013,
      temperatureC: 15,
    });
    expect(auto.altitude).toBeCloseTo(explicit.altitude, 6);
    expect(explicit.azimuth).toBeCloseTo(auto.azimuth, 6);
  });

  it('estimates the atmosphere from a high-altitude place differently than one at sea level', async () => {
    const engine = await getEngine();
    const sun = await engine.position(JD_LONDON_NOON, SE.SE_SUN);
    const seaLevel = await engine.azimuthAltitude(JD_LONDON_NOON, sun, LONDON);
    const highAltitude = await engine.azimuthAltitude(JD_LONDON_NOON, sun, { ...LONDON, altitude: 5000 });
    // Thinner air at 5 km bends light less, so the refraction correction (the gap
    // between true and apparent altitude) shrinks — proof `pressureHPa: 0`'s
    // auto-estimate actually reads the place's altitude rather than ignoring it.
    const seaLevelRefraction = seaLevel.apparentAltitude - seaLevel.altitude;
    const highAltitudeRefraction = highAltitude.apparentAltitude - highAltitude.altitude;
    expect(Math.abs(highAltitudeRefraction)).toBeLessThan(Math.abs(seaLevelRefraction));
  });
});
