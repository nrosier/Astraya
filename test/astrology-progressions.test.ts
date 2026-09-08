import { describe, expect, it } from 'vitest';
import {
  ageInYears,
  mcArc,
  NAIBOD_DAILY_MOTION,
  progressedJulianDay,
  shiftHouses,
  TROPICAL_YEAR_DAYS,
} from '../src/astrology/progressions.js';
import type { HousePositions } from '../src/ephemeris/types.js';

const NATAL_JD = 2448423.5; // arbitrary fixed epoch, exact value is not the point

const NATAL_HOUSES: HousePositions = {
  cusps: [0, 10, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340],
  ascendant: 10,
  midheaven: 280,
  armc: 275,
  vertex: 100,
  equatorialAscendant: 15,
  coAscendantKoch: 20,
  coAscendantMunkasey: 25,
  polarAscendant: 30,
  system: 'P',
};

describe('ageInYears (#46)', () => {
  it('is one year per tropical-year of days elapsed', () => {
    expect(ageInYears(NATAL_JD, NATAL_JD + TROPICAL_YEAR_DAYS)).toBeCloseTo(1, 10);
    expect(ageInYears(NATAL_JD, NATAL_JD + TROPICAL_YEAR_DAYS * 30)).toBeCloseTo(30, 10);
  });

  it('is zero at the natal moment itself', () => {
    expect(ageInYears(NATAL_JD, NATAL_JD)).toBe(0);
  });

  it('is negative before birth', () => {
    expect(ageInYears(NATAL_JD, NATAL_JD - TROPICAL_YEAR_DAYS)).toBeCloseTo(-1, 10);
  });
});

describe('progressedJulianDay (#46)', () => {
  it('advances one day of ephemeris time per year of age (day-for-year)', () => {
    expect(progressedJulianDay(NATAL_JD, NATAL_JD + TROPICAL_YEAR_DAYS * 30)).toBeCloseTo(NATAL_JD + 30, 10);
  });

  it('is the natal day itself at age zero', () => {
    expect(progressedJulianDay(NATAL_JD, NATAL_JD)).toBe(NATAL_JD);
  });
});

describe('mcArc (#46)', () => {
  it('naibod advances by the mean solar rate times age, independent of the actual sun', () => {
    const age = 30;
    expect(mcArc('naibod', age, 100, 999)).toBeCloseTo(age * NAIBOD_DAILY_MOTION, 10);
  });

  it('solarArc uses the true sun movement, independent of age', () => {
    expect(mcArc('solarArc', 30, 80, 95)).toBeCloseTo(15, 10);
  });

  it('solarArc handles the sun wrapping past 0 Aries', () => {
    // A natal sun near the end of the zodiac and a progressed sun just past it wrap the
    // naive subtraction negative; the arc itself is not normalised (see shiftHouses).
    expect(mcArc('solarArc', 1, 350, 5)).toBeCloseTo(-345, 10);
  });
});

describe('shiftHouses (#46)', () => {
  it('rotates every cusp and named angle by the same arc', () => {
    const shifted = shiftHouses(NATAL_HOUSES, 10);
    expect(shifted.cusps).toEqual(NATAL_HOUSES.cusps.map((cusp) => cusp + 10));
    expect(shifted.ascendant).toBe(20);
    expect(shifted.midheaven).toBe(290);
    expect(shifted.armc).toBe(285);
    expect(shifted.vertex).toBe(110);
    expect(shifted.equatorialAscendant).toBe(25);
    expect(shifted.coAscendantKoch).toBe(30);
    expect(shifted.coAscendantMunkasey).toBe(35);
    expect(shifted.polarAscendant).toBe(40);
  });

  it('preserves the house system and an existing warning', () => {
    const withWarning: HousePositions = { ...NATAL_HOUSES, warning: 'fallback to Porphyry at this latitude' };
    const shifted = shiftHouses(withWarning, 5);
    expect(shifted.system).toBe('P');
    expect(shifted.warning).toBe('fallback to Porphyry at this latitude');
  });

  it('wraps every shifted angle back into [0, 360)', () => {
    const shifted = shiftHouses(NATAL_HOUSES, 30);
    // 340 + 30 wraps to 10.
    expect(shifted.cusps[12]).toBeCloseTo(10, 10);
    // 280 + 30 wraps to 310, well inside range, but a bigger arc should also wrap the MC.
    const wrappedMc = shiftHouses(NATAL_HOUSES, 100);
    expect(wrappedMc.midheaven).toBeCloseTo(20, 10);
  });

  it('leaves houses unchanged for a zero arc', () => {
    const shifted = shiftHouses(NATAL_HOUSES, 0);
    expect(shifted).toEqual(NATAL_HOUSES);
  });

  it('accepts every symbolic method as the arc source', () => {
    const methods: ('naibod' | 'solarArc')[] = ['naibod', 'solarArc'];
    for (const method of methods) {
      const arc = mcArc(method, 10, 0, 10);
      expect(shiftHouses(NATAL_HOUSES, arc).midheaven).toBeGreaterThanOrEqual(0);
    }
  });
});
