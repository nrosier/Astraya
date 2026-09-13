import { describe, expect, it } from 'vitest';
import {
  greatCirclePath,
  horizonLine,
  localSpaceLine,
  longitudeFromArmc,
  meridianLine,
} from '../src/astrology/astrocartography.js';
import type { GeoPosition } from '../src/ephemeris/types.js';
import type { EquatorialPoint } from '../src/astrology/fixed-stars.js';

describe('longitudeFromArmc (#171)', () => {
  it('is a plain subtraction from the reference ARMC', () => {
    expect(longitudeFromArmc(130, 100)).toBeCloseTo(30, 9);
  });

  it('wraps through the antimeridian into [-180, 180)', () => {
    expect(longitudeFromArmc(10, 200)).toBeCloseTo(170, 9); // raw -190 wraps to +170
    expect(longitudeFromArmc(350, 10)).toBeCloseTo(-20, 9); // raw 340 wraps to -20
  });

  it('does not depend on where the reference ARMC itself sits', () => {
    const a = longitudeFromArmc(130, 0);
    const b = longitudeFromArmc(130 + 47, 47);
    expect(b).toBeCloseTo(a, 9);
  });
});

describe('meridianLine (#171)', () => {
  const point: EquatorialPoint = { rightAscension: 100, declination: 15 };

  it("places MC where local sidereal time equals the point's right ascension", () => {
    const mc = meridianLine('MC', 0, point, 40);
    expect(mc.longitude).toBeCloseTo(longitudeFromArmc(point.rightAscension, 40), 9);
  });

  it('places IC exactly 180 degrees of longitude from MC, independent of armc0', () => {
    for (const armc0 of [0, 40, 200, -75]) {
      const mc = meridianLine('MC', 0, point, armc0);
      const ic = meridianLine('IC', 0, point, armc0);
      const difference = (((mc.longitude - ic.longitude) % 360) + 360) % 360;
      expect(difference).toBeCloseTo(180, 9);
    }
  });
});

describe('horizonLine (#171)', () => {
  it('produces one unbroken segment spanning the full sampled range for an equatorial point', () => {
    const equatorPoint: EquatorialPoint = { rightAscension: 50, declination: 0 };
    const ac = horizonLine('AC', 0, equatorPoint, 0, { maxAbsLatitude: 80, latitudeStepDeg: 5 });
    expect(ac.segments).toHaveLength(1);
    expect(ac.segments[0]?.[0]?.latitude).toBeCloseTo(-80, 9);
    expect(ac.segments[0]?.at(-1)?.latitude).toBeCloseTo(80, 9);
  });

  it('breaks off before the sampled poles for a high-declination point (circumpolar there)', () => {
    const highDeclination: EquatorialPoint = { rightAscension: 50, declination: 80 };
    const ac = horizonLine('AC', 0, highDeclination, 0, { maxAbsLatitude: 80, latitudeStepDeg: 1 });
    expect(ac.segments).toHaveLength(1);
    const latitudes = ac.segments[0] ?? [];
    expect(latitudes[0]?.latitude).toBeGreaterThan(-80);
    expect(latitudes.at(-1)?.latitude).toBeLessThan(80);
  });

  it('AC and DC longitudes differ at a given latitude (rising vs. setting side of the sky)', () => {
    const point: EquatorialPoint = { rightAscension: 50, declination: 10 };
    const ac = horizonLine('AC', 0, point, 0, { maxAbsLatitude: 40, latitudeStepDeg: 40 });
    const dc = horizonLine('DC', 0, point, 0, { maxAbsLatitude: 40, latitudeStepDeg: 40 });
    expect(ac.segments[0]?.[0]?.longitude).not.toBeCloseTo(dc.segments[0]?.[0]?.longitude ?? Number.NaN, 3);
  });
});

describe('greatCirclePath (#171)', () => {
  const origin: GeoPosition = { latitude: 0, longitude: 0, altitude: 0 };

  it('starts exactly at the origin', () => {
    const path = greatCirclePath(origin, 45, { stepDeg: 10, maxDistanceDeg: 20 });
    expect(path[0]?.latitude).toBeCloseTo(0, 9);
    expect(path[0]?.longitude).toBeCloseTo(0, 9);
  });

  it('moves only in latitude on bearing 0 (due north)', () => {
    const path = greatCirclePath(origin, 0, { stepDeg: 10, maxDistanceDeg: 40 });
    for (const point of path) expect(point.longitude).toBeCloseTo(0, 6);
    expect(path.at(-1)?.latitude).toBeCloseTo(40, 6);
  });

  it('moves only in longitude on bearing 90 at the equator (due east)', () => {
    const path = greatCirclePath(origin, 90, { stepDeg: 10, maxDistanceDeg: 40 });
    for (const point of path) expect(point.latitude).toBeCloseTo(0, 6);
    expect(path.at(-1)?.longitude).toBeCloseTo(40, 6);
  });

  it('wraps longitude across the antimeridian rather than clamping at it', () => {
    const nearAntimeridian: GeoPosition = { latitude: 0, longitude: 179, altitude: 0 };
    const path = greatCirclePath(nearAntimeridian, 90, { stepDeg: 1, maxDistanceDeg: 2 });
    // Two degrees east of longitude 179 is longitude -179, not 181 — the value must
    // have wrapped through the antimeridian, and every value must stay in range.
    expect(path.at(-1)?.longitude).toBeCloseTo(-179, 6);
    for (const point of path) {
      expect(point.longitude).toBeGreaterThanOrEqual(-180);
      expect(point.longitude).toBeLessThan(180);
    }
  });
});

describe('localSpaceLine (#171)', () => {
  it('runs the reciprocal bearing backward from the same place', () => {
    const place: GeoPosition = { latitude: 51.5, longitude: -0.13, altitude: 0 };
    const line = localSpaceLine(0, place, 70, { stepDeg: 5, maxDistanceDeg: 15 });
    const expectedBackward = greatCirclePath(place, 70 + 180, { stepDeg: 5, maxDistanceDeg: 15 });
    expect(line.backward).toEqual(expectedBackward);
    expect(line.forward).not.toEqual(line.backward);
  });
});
