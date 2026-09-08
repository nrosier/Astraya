import { describe, expect, it } from 'vitest';
import { bodyByKey } from '../src/astrology/bodies.js';
import {
  detrimentRulerOf,
  essentialDignities,
  exaltationRulerOf,
  fallRulerOf,
  rulerOf,
} from '../src/astrology/dignities.js';

function id(key: string): number {
  const body = bodyByKey(key);
  if (!body) throw new Error(`test fixture bug: unknown body key "${key}"`);
  return body.id;
}

describe('rulerOf (#25)', () => {
  it('gives every sign a traditional ruler, with Mars/Saturn/Jupiter doubling up', () => {
    const expected = [
      'mars',
      'venus',
      'mercury',
      'moon',
      'sun',
      'mercury',
      'venus',
      'mars',
      'jupiter',
      'saturn',
      'saturn',
      'jupiter',
    ];
    expected.forEach((key, sign) => {
      expect(rulerOf(sign)).toBe(id(key));
    });
  });

  it('defaults to the traditional scheme when none is given', () => {
    expect(rulerOf(7)).toBe(rulerOf(7, 'traditional'));
  });

  it('overrides only Scorpio, Aquarius and Pisces under the modern scheme', () => {
    expect(rulerOf(7, 'modern')).toBe(id('pluto'));
    expect(rulerOf(10, 'modern')).toBe(id('uranus'));
    expect(rulerOf(11, 'modern')).toBe(id('neptune'));

    // Every other sign is unchanged from the traditional scheme.
    for (let sign = 0; sign < 12; sign += 1) {
      if (sign === 7 || sign === 10 || sign === 11) continue;
      expect(rulerOf(sign, 'modern')).toBe(rulerOf(sign, 'traditional'));
    }
  });

  it('rejects a sign index outside [0, 11]', () => {
    expect(() => rulerOf(12)).toThrow(RangeError);
    expect(() => rulerOf(-1)).toThrow(RangeError);
  });
});

describe('exaltationRulerOf (#25)', () => {
  it('is defined for exactly the seven classical exaltation signs', () => {
    expect(exaltationRulerOf(0)).toBe(id('sun')); // Aries
    expect(exaltationRulerOf(1)).toBe(id('moon')); // Taurus
    expect(exaltationRulerOf(3)).toBe(id('jupiter')); // Cancer
    expect(exaltationRulerOf(5)).toBe(id('mercury')); // Virgo
    expect(exaltationRulerOf(6)).toBe(id('saturn')); // Libra
    expect(exaltationRulerOf(9)).toBe(id('mars')); // Capricorn
    expect(exaltationRulerOf(11)).toBe(id('venus')); // Pisces
  });

  it('is undefined for the five signs with no classical exaltation', () => {
    for (const sign of [2, 4, 7, 8, 10]) {
      expect(exaltationRulerOf(sign)).toBeUndefined();
    }
  });
});

describe('detrimentRulerOf (#25)', () => {
  it('is the ruler of the opposite sign', () => {
    for (let sign = 0; sign < 12; sign += 1) {
      expect(detrimentRulerOf(sign)).toBe(rulerOf((sign + 6) % 12));
    }
  });

  it('respects the rulership scheme', () => {
    // Taurus (1) is opposite Scorpio (7): modern ruler Pluto, traditional Mars.
    expect(detrimentRulerOf(1, 'traditional')).toBe(id('mars'));
    expect(detrimentRulerOf(1, 'modern')).toBe(id('pluto'));
  });
});

describe('fallRulerOf (#25)', () => {
  it('is the exaltation ruler of the opposite sign', () => {
    expect(fallRulerOf(6)).toBe(id('sun')); // Libra: opposite Aries (Sun exalted)
    expect(fallRulerOf(7)).toBe(id('moon')); // Scorpio: opposite Taurus (Moon exalted)
    expect(fallRulerOf(9)).toBe(id('jupiter')); // Capricorn: opposite Cancer (Jupiter exalted)
    expect(fallRulerOf(11)).toBe(id('mercury')); // Pisces: opposite Virgo (Mercury exalted)
    expect(fallRulerOf(0)).toBe(id('saturn')); // Aries: opposite Libra (Saturn exalted)
    expect(fallRulerOf(3)).toBe(id('mars')); // Cancer: opposite Capricorn (Mars exalted)
    expect(fallRulerOf(5)).toBe(id('venus')); // Virgo: opposite Pisces (Venus exalted)
  });

  it('is undefined for signs whose opposite has no exaltation', () => {
    for (const sign of [1, 2, 4, 8, 10]) {
      expect(fallRulerOf(sign)).toBeUndefined();
    }
  });
});

describe('essentialDignities (#25)', () => {
  it('flags rulership for Mars at 15 Aries', () => {
    const dignities = essentialDignities(id('mars'), 15);
    expect(dignities).toEqual({ ruler: true, exalted: false, detriment: false, fall: false });
  });

  it('flags exaltation for the Sun at 15 Aries', () => {
    const dignities = essentialDignities(id('sun'), 15);
    expect(dignities).toEqual({ ruler: false, exalted: true, detriment: false, fall: false });
  });

  it('flags detriment for Mars at 15 Libra (opposite its own rulership)', () => {
    const dignities = essentialDignities(id('mars'), 6 * 30 + 15);
    expect(dignities).toEqual({ ruler: false, exalted: false, detriment: true, fall: false });
  });

  it('flags fall for Saturn at 15 Aries (opposite its exaltation in Libra)', () => {
    const dignities = essentialDignities(id('saturn'), 15);
    expect(dignities).toEqual({ ruler: false, exalted: false, detriment: false, fall: true });
  });

  it('flags nothing for an unrelated body in an unrelated sign', () => {
    const dignities = essentialDignities(id('venus'), 8 * 30 + 10); // Venus in Sagittarius
    expect(dignities).toEqual({ ruler: false, exalted: false, detriment: false, fall: false });
  });

  it('switches Scorpio rulership to Pluto only under the modern scheme', () => {
    const longitude = 7 * 30 + 5; // 5 degrees into Scorpio
    expect(essentialDignities(id('mars'), longitude, 'traditional').ruler).toBe(true);
    expect(essentialDignities(id('mars'), longitude, 'modern').ruler).toBe(false);
    expect(essentialDignities(id('pluto'), longitude, 'modern').ruler).toBe(true);
  });

  it('wraps longitude before determining the sign', () => {
    expect(essentialDignities(id('mars'), 360 + 15)).toEqual(essentialDignities(id('mars'), 15));
    expect(essentialDignities(id('mars'), -345)).toEqual(essentialDignities(id('mars'), 15));
  });
});
