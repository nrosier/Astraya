import { describe, expect, it } from 'vitest';
import { formatCoordinate, todayInputValue } from '../src/ui/format.js';

describe('todayInputValue', () => {
  it('matches the visitor-local calendar date in yyyy-mm-dd form', () => {
    const now = new Date();
    const year = String(now.getFullYear()).padStart(4, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    expect(todayInputValue()).toBe(`${year}-${month}-${day}`);
  });
});

describe('formatCoordinate', () => {
  it('marks a positive latitude North and a positive longitude East, in en', () => {
    expect(formatCoordinate(51.5, 'lat', 'en')).toBe('51.50°N');
    expect(formatCoordinate(4.9, 'lon', 'en')).toBe('4.90°E');
  });

  it('marks a negative latitude South and a negative longitude West, in en', () => {
    expect(formatCoordinate(-33.87, 'lat', 'en')).toBe('33.87°S');
    expect(formatCoordinate(-0.12, 'lon', 'en')).toBe('0.12°W');
  });

  it('uses Dutch hemisphere letters (Z for South, O for East) and a comma decimal separator', () => {
    expect(formatCoordinate(51.5, 'lat', 'nl')).toBe('51,50°N');
    expect(formatCoordinate(4.9, 'lon', 'nl')).toBe('4,90°O');
    expect(formatCoordinate(-33.87, 'lat', 'nl')).toBe('33,87°Z');
    expect(formatCoordinate(-0.12, 'lon', 'nl')).toBe('0,12°W');
  });

  it('always prints a magnitude, never a signed number', () => {
    expect(formatCoordinate(-0, 'lat', 'en')).toBe('0.00°N');
  });
});
