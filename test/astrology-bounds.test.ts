import { describe, expect, it } from 'vitest';
import { bodyByKey } from '../src/astrology/bodies.js';
import { SIGNS } from '../src/astrology/signs.js';
import { boundRulerOf, boundsOf, type BoundsScheme } from '../src/astrology/bounds.js';

function id(key: string): number {
  const body = bodyByKey(key);
  if (!body) throw new Error(`test fixture bug: unknown body key "${key}"`);
  return body.id;
}

const SCHEMES: readonly BoundsScheme[] = ['egyptian', 'ptolemaic'];

describe('boundsOf completeness (#26)', () => {
  it.each(SCHEMES)('covers every sign with five contiguous, gap-free bounds summing to 30 degrees (%s)', (scheme) => {
    for (let sign = 0; sign < 12; sign += 1) {
      const bounds = boundsOf(sign, scheme);
      expect(bounds.length, `${scheme} sign ${sign}`).toBe(5);
      expect(bounds[0]?.from, `${scheme} sign ${sign}`).toBe(0);
      expect(bounds[bounds.length - 1]?.to, `${scheme} sign ${sign}`).toBe(30);
      for (let i = 0; i < bounds.length - 1; i += 1) {
        expect(bounds[i]?.to, `${scheme} sign ${sign} bound ${i}`).toBe(bounds[i + 1]?.from);
      }
    }
  });

  it.each(SCHEMES)('rejects a sign index outside [0, 11] (%s)', (scheme) => {
    expect(() => boundsOf(-1, scheme)).toThrow(RangeError);
    expect(() => boundsOf(12, scheme)).toThrow(RangeError);
  });

  const FIVE_BOUND_RULERS = ['jupiter', 'venus', 'mercury', 'mars', 'saturn'].map(id).sort();

  it.each(SCHEMES)(
    "assigns each sign's five bounds to exactly Jupiter, Venus, Mercury, Mars and Saturn, each once — never the Sun or Moon, never a repeat (%s)",
    (scheme) => {
      for (let sign = 0; sign < 12; sign += 1) {
        const rulers = boundsOf(sign, scheme)
          .map((b) => b.ruler)
          .sort();
        expect(rulers, `${scheme} sign ${sign}`).toEqual(FIVE_BOUND_RULERS);
      }
    },
  );
});

describe('boundRulerOf (#26)', () => {
  it('matches the Egyptian table for the first and last bound of Aries', () => {
    expect(boundRulerOf(3, 'egyptian')).toBe(id('jupiter')); // 0-6: Jupiter
    expect(boundRulerOf(29, 'egyptian')).toBe(id('saturn')); // 25-30: Saturn
  });

  it('matches the Ptolemaic table for a sign where the two schemes disagree', () => {
    // Capricorn: Egyptian starts with Mercury 0-7, Ptolemaic with Venus 0-6.
    expect(boundRulerOf(9 * 30 + 3, 'egyptian')).toBe(id('mercury'));
    expect(boundRulerOf(9 * 30 + 3, 'ptolemaic')).toBe(id('venus'));
  });

  it('defaults to the Egyptian scheme when none is given', () => {
    expect(boundRulerOf(3)).toBe(boundRulerOf(3, 'egyptian'));
  });

  it.each(SCHEMES)('returns a bound ruler for every degree of every sign, with no gaps (%s)', (scheme) => {
    for (let sign = 0; sign < SIGNS.length; sign += 1) {
      for (let degree = 0; degree < 30; degree += 1) {
        const longitude = sign * 30 + degree;
        expect(() => boundRulerOf(longitude, scheme), `${scheme} ${longitude}`).not.toThrow();
      }
    }
  });

  it('lands exactly on a bound boundary using the upper (not lower) bound', () => {
    // Aries 6 is the Jupiter/Venus boundary in the Egyptian table (0-6, 6-12).
    expect(boundRulerOf(6, 'egyptian')).toBe(id('venus'));
  });
});
