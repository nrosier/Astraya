import { describe, expect, it } from 'vitest';
import {
  SYNODIC_MONTH_DAYS,
  ageInSynodicMonths,
  minorProgressedJulianDay,
} from '../src/astrology/minor-progressions.js';

describe('SYNODIC_MONTH_DAYS (#48)', () => {
  it('is the familiar ~29.5-day synodic month, not the ~27.3-day sidereal one', () => {
    expect(SYNODIC_MONTH_DAYS).toBeGreaterThan(29);
    expect(SYNODIC_MONTH_DAYS).toBeLessThan(30);
  });
});

describe('ageInSynodicMonths (#48)', () => {
  it('divides elapsed real days by the synodic month', () => {
    expect(ageInSynodicMonths(0, SYNODIC_MONTH_DAYS * 4)).toBeCloseTo(4, 9);
  });

  it('goes negative before birth, same as ageInYears', () => {
    expect(ageInSynodicMonths(1000, 1000 - SYNODIC_MONTH_DAYS)).toBeCloseTo(-1, 9);
  });
});

describe('minorProgressedJulianDay (#48)', () => {
  it('tertiary: the day offset equals the age in lunar months', () => {
    const natalJd = 2440000;
    const targetJd = natalJd + SYNODIC_MONTH_DAYS * 10; // 10 lunar months of real time
    expect(minorProgressedJulianDay('tertiary', natalJd, targetJd)).toBeCloseTo(natalJd + 10, 9);
  });

  it('minor: the day offset equals the age in years, converted to lunar months', () => {
    const natalJd = 2440000;
    const targetJd = natalJd + 365.2425 * 3; // 3 years of real time
    expect(minorProgressedJulianDay('minor', natalJd, targetJd)).toBeCloseTo(natalJd + 3 * SYNODIC_MONTH_DAYS, 6);
  });

  it('gives tertiary and minor different progressed days for the same target, since the substitutions differ', () => {
    const natalJd = 2440000;
    const targetJd = natalJd + 365.2425 * 5;
    const tertiary = minorProgressedJulianDay('tertiary', natalJd, targetJd);
    const minor = minorProgressedJulianDay('minor', natalJd, targetJd);
    expect(Math.abs(tertiary - minor)).toBeGreaterThan(1);
  });

  it('returns the natal day unchanged at the moment of birth, for either method', () => {
    const natalJd = 2440000;
    expect(minorProgressedJulianDay('tertiary', natalJd, natalJd)).toBeCloseTo(natalJd, 9);
    expect(minorProgressedJulianDay('minor', natalJd, natalJd)).toBeCloseTo(natalJd, 9);
  });
});
