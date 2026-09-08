import { describe, expect, it } from 'vitest';
import { SIGNS, SIGN_SPAN, degreesInSign, oppositeSign, signIndex, signOf } from '../src/astrology/signs.js';

describe('the canonical zodiac sign registry', () => {
  it('has 12 signs, indexed 0..11, with distinct names', () => {
    expect(SIGNS).toHaveLength(12);
    SIGNS.forEach((sign, index) => {
      expect(sign.index).toBe(index);
    });
    expect(new Set(SIGNS.map((s) => s.name)).size).toBe(12);
  });

  it('spans exactly 360 degrees', () => {
    expect(SIGN_SPAN * 12).toBe(360);
  });

  it('assigns element and modality following the classical repeating pattern', () => {
    const elements = ['fire', 'earth', 'air', 'water'];
    const modalities = ['cardinal', 'fixed', 'mutable'];
    SIGNS.forEach((sign, index) => {
      expect(sign.element).toBe(elements[index % 4]);
      expect(sign.modality).toBe(modalities[index % 3]);
    });

    // Named boundary checks, so a reordering of the array can't accidentally
    // satisfy the pattern checks above.
    expect(SIGNS[0]?.name).toBe('Aries');
    expect(SIGNS[0]?.element).toBe('fire');
    expect(SIGNS[0]?.modality).toBe('cardinal');
    expect(SIGNS[6]?.name).toBe('Libra');
    expect(SIGNS[6]?.element).toBe('air');
    expect(SIGNS[6]?.modality).toBe('cardinal');
    expect(SIGNS[11]?.name).toBe('Pisces');
    expect(SIGNS[11]?.element).toBe('water');
    expect(SIGNS[11]?.modality).toBe('mutable');
  });
});

describe('signIndex and signOf', () => {
  it('places 0 degrees at the start of Aries', () => {
    expect(signIndex(0)).toBe(0);
    expect(signOf(0).name).toBe('Aries');
  });

  it('places 29.99 degrees still within Aries, and 30 within Taurus', () => {
    expect(signOf(29.99).name).toBe('Aries');
    expect(signOf(30).name).toBe('Taurus');
  });

  it('wraps negative and >=360 longitudes before indexing', () => {
    expect(signOf(-1).name).toBe('Pisces');
    expect(signOf(360).name).toBe('Aries');
    expect(signOf(725).name).toBe('Aries');
  });

  it('places 359.99 degrees within Pisces', () => {
    expect(signOf(359.99).name).toBe('Pisces');
  });
});

describe('degreesInSign', () => {
  it('is 0 at every sign boundary', () => {
    for (let sign = 0; sign < 12; sign += 1) {
      expect(degreesInSign(sign * 30)).toBeCloseTo(0, 10);
    }
  });

  it('tracks the offset within a sign', () => {
    expect(degreesInSign(45)).toBeCloseTo(15, 10);
    expect(degreesInSign(359)).toBeCloseTo(29, 10);
  });
});

describe('oppositeSign', () => {
  it('is 180 degrees away, and involutive', () => {
    for (let sign = 0; sign < 12; sign += 1) {
      expect(oppositeSign(sign)).toBe((sign + 6) % 12);
      expect(oppositeSign(oppositeSign(sign))).toBe(sign);
    }
  });

  it('pairs Aries with Libra, and Cancer with Capricorn', () => {
    expect(oppositeSign(0)).toBe(6);
    expect(oppositeSign(3)).toBe(9);
  });
});
