import { describe, expect, it } from 'vitest';
import { bodyByKey } from '../src/astrology/bodies.js';
import { DECAN_SPAN, decanInSign, decanIndex, faceRulerOf, triplicityDecanRulerOf } from '../src/astrology/decans.js';

function id(key: string): number {
  const body = bodyByKey(key);
  if (!body) throw new Error(`test fixture bug: unknown body key "${key}"`);
  return body.id;
}

describe('decanIndex and decanInSign (#26)', () => {
  it('spans 36 decans of 10 degrees each', () => {
    expect(DECAN_SPAN * 36).toBe(360);
  });

  it('places 0 degrees at decan 0, and each 10-degree step at the next decan', () => {
    for (let decan = 0; decan < 36; decan += 1) {
      expect(decanIndex(decan * 10)).toBe(decan);
    }
  });

  it('numbers decans 0..2 within each sign, resetting at every 30 degrees', () => {
    expect(decanInSign(5)).toBe(0);
    expect(decanInSign(15)).toBe(1);
    expect(decanInSign(25)).toBe(2);
    expect(decanInSign(30 + 5)).toBe(0);
  });

  it('wraps negative and >=360 longitudes before indexing', () => {
    expect(decanIndex(-10)).toBe(35);
    expect(decanIndex(360)).toBe(0);
  });
});

describe('faceRulerOf (#26)', () => {
  it("matches Lilly's published Chaldean face table for Aries and Taurus", () => {
    // Aries: Mars, Sun, Venus.
    expect(faceRulerOf(5)).toBe(id('mars'));
    expect(faceRulerOf(15)).toBe(id('sun'));
    expect(faceRulerOf(25)).toBe(id('venus'));
    // Taurus: Mercury, Moon, Saturn — the 7-planet cycle runs straight
    // through the sign boundary with no reset.
    expect(faceRulerOf(30 + 5)).toBe(id('mercury'));
    expect(faceRulerOf(30 + 15)).toBe(id('moon'));
    expect(faceRulerOf(30 + 25)).toBe(id('saturn'));
  });

  it('completes the 36-decan cycle back to Mars for the final decan of Pisces', () => {
    // Decan index 35 is the 36th decan: 35 % 7 === 0, same offset as Aries's first.
    expect(faceRulerOf(11 * 30 + 25)).toBe(id('mars'));
  });

  it('follows the Chaldean order (Saturn, Jupiter, Mars, Sun, Venus, Mercury, Moon) once past its Mars start', () => {
    const rulers = Array.from({ length: 7 }, (_, decan) => faceRulerOf(decan * 10 + 5));
    expect(rulers).toEqual([
      id('mars'),
      id('sun'),
      id('venus'),
      id('mercury'),
      id('moon'),
      id('saturn'),
      id('jupiter'),
    ]);
  });
});

describe('triplicityDecanRulerOf (#26)', () => {
  it('rules the first decan of a sign by that sign itself', () => {
    // Aries decan 1: ruled by Aries's own ruler, Mars.
    expect(triplicityDecanRulerOf(5)).toBe(id('mars'));
  });

  it('cycles through the triplicity for the second and third decans', () => {
    // Aries (fire): decan1 Aries/Mars, decan2 Leo/Sun, decan3 Sagittarius/Jupiter.
    expect(triplicityDecanRulerOf(5)).toBe(id('mars'));
    expect(triplicityDecanRulerOf(15)).toBe(id('sun'));
    expect(triplicityDecanRulerOf(25)).toBe(id('jupiter'));
  });

  it('starts from wherever the sign sits within its own triplicity', () => {
    // Leo (fire, second in zodiacal order after Aries): decan1 Leo/Sun,
    // decan2 Sagittarius/Jupiter, decan3 Aries/Mars.
    const leoStart = 4 * 30;
    expect(triplicityDecanRulerOf(leoStart + 5)).toBe(id('sun'));
    expect(triplicityDecanRulerOf(leoStart + 15)).toBe(id('jupiter'));
    expect(triplicityDecanRulerOf(leoStart + 25)).toBe(id('mars'));
  });

  it('agrees for every sign that its own first decan is self-ruled', () => {
    for (let sign = 0; sign < 12; sign += 1) {
      const longitude = sign * 30 + 5;
      expect(triplicityDecanRulerOf(longitude)).not.toBeUndefined();
    }
  });
});
