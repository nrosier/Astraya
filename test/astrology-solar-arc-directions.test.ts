import { describe, expect, it } from 'vitest';
import {
  arcsToExactness,
  directedSubjects,
  directPositions,
  fixedNatalSubjects,
} from '../src/astrology/solar-arc-directions.js';
import type { BodyCategory } from '../src/astrology/bodies.js';
import type { BodyPosition } from '../src/ephemeris/types.js';

function position(body: number, longitude: number, longitudeSpeed = 1): BodyPosition {
  return {
    body,
    longitude,
    latitude: 0,
    distance: 1,
    longitudeSpeed,
    latitudeSpeed: 0,
    distanceSpeed: 0,
    retrograde: longitudeSpeed < 0,
  };
}

const categoryOf = (): BodyCategory => 'planet';

describe('directPositions (#47)', () => {
  it('shifts every natal longitude by the same arc', () => {
    const natal = [position(0, 10), position(1, 100), position(2, 350)];
    const directed = directPositions(natal, 20);
    expect(directed).toEqual([
      { body: 0, longitude: 30 },
      { body: 1, longitude: 120 },
      { body: 2, longitude: 10 }, // 350 + 20 wraps to 10
    ]);
  });

  it('leaves positions unchanged for a zero arc', () => {
    const natal = [position(0, 45)];
    expect(directPositions(natal, 0)).toEqual([{ body: 0, longitude: 45 }]);
  });
});

describe('directedSubjects (#47)', () => {
  it('carries the given arc speed and a neutral shape, since a directed point has no speed of its own', () => {
    const directed = directPositions([position(0, 10)], 5);
    const [subject] = directedSubjects(directed, categoryOf, 0.98);
    expect(subject).toBeDefined();
    expect(subject?.position.longitude).toBe(15);
    expect(subject?.position.longitudeSpeed).toBe(0.98);
    expect(subject?.position.retrograde).toBe(false);
  });
});

describe('fixedNatalSubjects (#47)', () => {
  it('zeroes out the natal body speed, since it is the fixed target being checked against', () => {
    const natal = [position(0, 10, 1.2)];
    const [subject] = fixedNatalSubjects(natal, categoryOf);
    expect(subject?.position.longitudeSpeed).toBe(0);
    expect(subject?.position.longitude).toBe(10);
  });
});

describe('arcsToExactness (#47)', () => {
  it('finds the arc that brings a directed body into an exact conjunction with a natal one', () => {
    // Directed body at 10, natal target at 40: arc of 30 makes it exact.
    expect(arcsToExactness(10, 40, 0)).toContain(30);
  });

  it('finds the arc for a square approached from either side', () => {
    // Natal separation is 40 degrees; a square (90) is reached at arc = 40-90 (wrapped) or 40+90.
    const candidates = arcsToExactness(10, 50, 90);
    expect(candidates).toHaveLength(2);
    expect(candidates).toContain(130); // 40 + 90
    expect(candidates).toContain(310); // (40 - 90) wrapped to [0, 360)
  });

  it('collapses to a single candidate for an opposition, since both sides coincide', () => {
    // Natal separation 0 (conjunct at birth), aspect angle 180: 0-180 and 0+180 both wrap to 180.
    expect(arcsToExactness(10, 10, 180)).toEqual([180]);
  });

  it('is exact right away (arc 0) when the natal separation already matches the aspect', () => {
    // Natal separation 90 degrees, squared already: one candidate is 0.
    expect(arcsToExactness(10, 100, 90)).toContain(0);
  });
});
