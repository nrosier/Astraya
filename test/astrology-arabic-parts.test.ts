import { describe, expect, it } from 'vitest';
import { arabicPart, partOfFortune, partOfSpirit, sectReversingPart } from '../src/astrology/arabic-parts.js';

describe('arabicPart (#29)', () => {
  it('computes base + a - b, wrapped to a longitude', () => {
    expect(arabicPart(10, 20, 5)).toBe(25);
    expect(arabicPart(10, 5, 20)).toBe(355); // wraps below 0
    expect(arabicPart(350, 20, 5)).toBe(5); // wraps above 360
  });
});

describe('sectReversingPart (#29)', () => {
  it('uses dayA, dayB in day-chart order', () => {
    expect(sectReversingPart('day', 0, 200, 100)).toBe(100);
  });

  it('swaps the operands for a night chart', () => {
    expect(sectReversingPart('night', 0, 200, 100)).toBe(260); // 0 + 100 - 200, wrapped
  });
});

describe('partOfFortune (#29)', () => {
  const ascendant = 0;
  const sun = 100;
  const moon = 200;

  it('is Ascendant + Moon - Sun in a day chart', () => {
    expect(partOfFortune('day', ascendant, sun, moon)).toBe(100);
  });

  it('is Ascendant + Sun - Moon in a night chart', () => {
    expect(partOfFortune('night', ascendant, sun, moon)).toBe(260);
  });

  it('differs between day and night charts for the same positions', () => {
    expect(partOfFortune('day', ascendant, sun, moon)).not.toBe(partOfFortune('night', ascendant, sun, moon));
  });
});

describe('partOfSpirit (#29)', () => {
  const ascendant = 0;
  const sun = 100;
  const moon = 200;

  it('is Ascendant + Sun - Moon in a day chart', () => {
    expect(partOfSpirit('day', ascendant, sun, moon)).toBe(260);
  });

  it('is Ascendant + Moon - Sun in a night chart', () => {
    expect(partOfSpirit('night', ascendant, sun, moon)).toBe(100);
  });

  it('is the mirror of Fortune for the same chart and sect', () => {
    expect(partOfSpirit('day', ascendant, sun, moon)).toBe(partOfFortune('night', ascendant, sun, moon));
    expect(partOfSpirit('night', ascendant, sun, moon)).toBe(partOfFortune('day', ascendant, sun, moon));
  });

  it('differs between day and night charts for the same positions', () => {
    expect(partOfSpirit('day', ascendant, sun, moon)).not.toBe(partOfSpirit('night', ascendant, sun, moon));
  });
});
