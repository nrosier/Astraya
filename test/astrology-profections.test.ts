import { describe, expect, it } from 'vitest';
import { annualProfection, monthlyProfection } from '../src/astrology/profections.js';

// 14° Leo — signIndex 4, 14° within the sign.
const ASCENDANT = 4 * 30 + 14;

describe('annualProfection (#168)', () => {
  it('profects to the Ascendant itself at age zero', () => {
    const point = annualProfection(ASCENDANT, 0);
    expect(point.signIndex).toBe(4);
    expect(point.longitude).toBeCloseTo(ASCENDANT, 10);
  });

  it('advances one sign per completed year of age', () => {
    expect(annualProfection(ASCENDANT, 1).signIndex).toBe(5);
    expect(annualProfection(ASCENDANT, 3).signIndex).toBe(7);
  });

  it('only the completed year counts, not the fractional remainder', () => {
    expect(annualProfection(ASCENDANT, 3.9).signIndex).toBe(7);
  });

  it('wraps around the zodiac every 12 years', () => {
    expect(annualProfection(ASCENDANT, 12).signIndex).toBe(4);
    expect(annualProfection(ASCENDANT, 24).signIndex).toBe(4);
    expect(annualProfection(ASCENDANT, 13).signIndex).toBe(5);
  });

  it('keeps the Ascendant degree within whichever sign the year lands on', () => {
    const point = annualProfection(ASCENDANT, 5);
    expect(point.longitude).toBeCloseTo(point.signIndex * 30 + 14, 10);
  });

  it('handles ages before birth (negative), still wrapping into [0, 11]', () => {
    const point = annualProfection(ASCENDANT, -1);
    expect(point.signIndex).toBe(3);
    const wrapped = annualProfection(ASCENDANT, -5);
    expect(wrapped.signIndex).toBe(11);
  });
});

describe('monthlyProfection (#168)', () => {
  it('starts the year at the year’s own profected sign (month 0)', () => {
    const point = monthlyProfection(ASCENDANT, 3);
    expect(point.monthIndex).toBe(0);
    expect(point.signIndex).toBe(annualProfection(ASCENDANT, 3).signIndex);
  });

  it('advances one further sign per twelfth of the year elapsed', () => {
    expect(monthlyProfection(ASCENDANT, 3 + 1 / 12).monthIndex).toBe(1);
    expect(monthlyProfection(ASCENDANT, 3 + 6 / 12).monthIndex).toBe(6);
    expect(monthlyProfection(ASCENDANT, 3 + 11.9 / 12).monthIndex).toBe(11);
  });

  it('combines the year and month rotation into one sign index', () => {
    // Year 3 profects to signIndex 7 (Scorpio); month 6 of that year adds 6 more signs.
    const point = monthlyProfection(ASCENDANT, 3 + 6 / 12);
    expect(point.signIndex).toBe((7 + 6) % 12);
  });

  it('reaches month 11 one sign short of the following year’s own profection, not back at month 0', () => {
    const point = monthlyProfection(ASCENDANT, 3 + 11 / 12);
    expect(point.monthIndex).toBe(11);
    expect(point.signIndex).toBe(6);
    // The *next* year's profection (age 4) starts one sign further still.
    expect(annualProfection(ASCENDANT, 4).signIndex).toBe(8);
  });
});
