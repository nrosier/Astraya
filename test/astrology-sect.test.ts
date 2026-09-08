import { describe, expect, it } from 'vitest';
import {
  isAboveHorizon,
  sectOf,
  solarConditionOf,
  solarConditionOfPosition,
  solarPhaseOf,
} from '../src/astrology/sect.js';

describe('isAboveHorizon (#28)', () => {
  it('is true for the half of the ecliptic 180-360 degrees past the ascendant', () => {
    const ascendant = 100;
    expect(isAboveHorizon(ascendant + 179, ascendant)).toBe(false);
    expect(isAboveHorizon(ascendant + 180, ascendant)).toBe(true);
    expect(isAboveHorizon(ascendant + 359, ascendant)).toBe(true);
    expect(isAboveHorizon(ascendant, ascendant)).toBe(false); // exactly on the ascendant: rising, not yet above
  });

  it('wraps longitude and ascendant before comparing', () => {
    const ascendant = 350;
    expect(isAboveHorizon(340, ascendant)).toBe(true); // 340 is 350 past the ascendant, wrapped
    expect(isAboveHorizon(160, ascendant)).toBe(false);
  });
});

describe('sectOf (#28)', () => {
  it('is a day chart when the Sun is above the horizon', () => {
    const ascendant = 0;
    expect(sectOf(200, ascendant)).toBe('day'); // Sun 200 degrees past ascendant, in the 7-12 half
  });

  it('is a night chart when the Sun is below the horizon', () => {
    const ascendant = 0;
    expect(sectOf(90, ascendant)).toBe('night'); // Sun only 90 degrees past ascendant, in the 1-6 half
  });
});

describe('solarPhaseOf (#28)', () => {
  it('is oriental when the body is behind the sun (rises earlier that day)', () => {
    expect(solarPhaseOf(90, 100)).toBe('oriental');
  });

  it('is occidental when the body is ahead of the sun (rises later that day)', () => {
    expect(solarPhaseOf(110, 100)).toBe('occidental');
  });

  it('is undefined when conjunct or exactly opposite the sun', () => {
    expect(solarPhaseOf(100, 100)).toBeUndefined();
    expect(solarPhaseOf(280, 100)).toBeUndefined();
  });

  it('wraps longitude before comparing', () => {
    expect(solarPhaseOf(350, 10)).toBe('oriental'); // 350 is 20 degrees behind 10, wrapped
  });
});

describe('solarConditionOf (#28)', () => {
  const sun = 100;

  it('is cazimi within 17 arcminutes of exact conjunction', () => {
    expect(solarConditionOf(sun, sun)).toBe('cazimi');
    expect(solarConditionOf(sun + 17 / 60, sun)).toBe('cazimi');
  });

  it('is combust beyond cazimi and within 8 degrees', () => {
    expect(solarConditionOf(sun + 1, sun)).toBe('combust');
    expect(solarConditionOf(sun + 8, sun)).toBe('combust');
  });

  it('is under the beams beyond combustion and within 15 degrees', () => {
    expect(solarConditionOf(sun + 9, sun)).toBe('underTheBeams');
    expect(solarConditionOf(sun + 15, sun)).toBe('underTheBeams');
  });

  it('is free beyond 15 degrees', () => {
    expect(solarConditionOf(sun + 16, sun)).toBe('free');
    expect(solarConditionOf(sun + 180, sun)).toBe('free'); // opposition: full phase, nowhere near the sun
  });

  it('uses unsigned separation regardless of direction', () => {
    expect(solarConditionOf(sun - 5, sun)).toBe('combust');
  });
});

describe('solarConditionOfPosition (#28)', () => {
  it('delegates to solarConditionOf using the longitude field', () => {
    const sun = {
      body: 0,
      longitude: 100,
      latitude: 0,
      distance: 1,
      longitudeSpeed: 1,
      latitudeSpeed: 0,
      distanceSpeed: 0,
      retrograde: false,
    };
    const mercury = {
      body: 2,
      longitude: 103,
      latitude: 1,
      distance: 0.5,
      longitudeSpeed: 1,
      latitudeSpeed: 0,
      distanceSpeed: 0,
      retrograde: false,
    };
    expect(solarConditionOfPosition(mercury, sun)).toBe('combust');
  });
});

describe('day and night charts (#28)', () => {
  it('classifies a day chart: sun above horizon, and its orientality/condition for another body', () => {
    const ascendant = 200; // Libra rising
    const sunLongitude = 4 * 30 + 10; // Sun in Leo, well above the horizon from this ascendant
    expect(sectOf(sunLongitude, ascendant)).toBe('day');

    const venusLongitude = sunLongitude - 20; // Venus behind the sun: oriental, morning star
    expect(solarPhaseOf(venusLongitude, sunLongitude)).toBe('oriental');
    expect(solarConditionOf(venusLongitude, sunLongitude)).toBe('free');
  });

  it('classifies a night chart: sun below horizon, and its orientality/condition for another body', () => {
    const ascendant = 200;
    const sunLongitude = 250; // only 50 degrees past the ascendant: below horizon
    expect(sectOf(sunLongitude, ascendant)).toBe('night');

    const marsLongitude = sunLongitude + 5; // Mars just ahead of the sun: occidental, combust
    expect(solarPhaseOf(marsLongitude, sunLongitude)).toBe('occidental');
    expect(solarConditionOf(marsLongitude, sunLongitude)).toBe('combust');
  });
});
