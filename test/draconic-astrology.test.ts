/**
 * Unit tests for the pure draconic math (#398) — no ephemeris needed, since
 * `draconicLongitude`/`draconicPosition` are plain arithmetic over longitudes already computed.
 */
import { describe, expect, it } from 'vitest';
import { draconicLongitude, draconicPosition } from '../src/astrology/draconic.js';
import type { BodyPosition } from '../src/ephemeris/types.js';

describe('draconicLongitude (#398)', () => {
  it('subtracts the node longitude and wraps back into 0-360', () => {
    expect(draconicLongitude(100, 30)).toBe(70);
    expect(draconicLongitude(10, 30)).toBe(340); // -20 wraps to 340
    expect(draconicLongitude(0, 0)).toBe(0);
  });

  it('is always in [0, 360)', () => {
    for (let lon = 0; lon < 360; lon += 17) {
      for (let node = 0; node < 360; node += 23) {
        const value = draconicLongitude(lon, node);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(360);
      }
    }
  });

  it('node at 0° Aries is the identity', () => {
    expect(draconicLongitude(123.456, 0)).toBeCloseTo(123.456, 9);
  });
});

describe('draconicPosition (#398)', () => {
  const natal: BodyPosition = {
    body: 0,
    longitude: 100,
    latitude: 1.5,
    distance: 1,
    longitudeSpeed: -0.5,
    latitudeSpeed: 0,
    distanceSpeed: 0,
    retrograde: true,
  };

  it('transforms only longitude, carrying latitude/speeds/retrograde over unchanged', () => {
    const draconic = draconicPosition(natal, 30);
    expect(draconic.longitude).toBe(70);
    expect(draconic.latitude).toBe(natal.latitude);
    expect(draconic.distance).toBe(natal.distance);
    expect(draconic.longitudeSpeed).toBe(natal.longitudeSpeed);
    expect(draconic.retrograde).toBe(natal.retrograde);
  });
});
