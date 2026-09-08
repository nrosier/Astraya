import { describe, expect, it } from 'vitest';
import { bodyByKey } from '../src/astrology/bodies.js';
import { dispositorChain, isMutualReception } from '../src/astrology/dispositors.js';

function id(key: string): number {
  const body = bodyByKey(key);
  if (!body) throw new Error(`test fixture bug: unknown body key "${key}"`);
  return body.id;
}

describe('dispositorChain (#34)', () => {
  it('terminates immediately for a body that rules its own sign', () => {
    const positions = new Map([[id('sun'), 4 * 30 + 15]]); // Sun in Leo
    const result = dispositorChain(id('sun'), positions);
    expect(result).toEqual({ chain: [id('sun')], finalDispositor: id('sun'), cycle: false });
  });

  it('walks a multi-step chain to its final dispositor', () => {
    // Moon in Aries (ruled by Mars) -> Mars in Leo (ruled by Sun) -> Sun in Leo (self).
    const positions = new Map([
      [id('moon'), 10],
      [id('mars'), 4 * 30 + 5],
      [id('sun'), 4 * 30 + 20],
    ]);
    const result = dispositorChain(id('moon'), positions);
    expect(result.chain).toEqual([id('moon'), id('mars'), id('sun')]);
    expect(result.finalDispositor).toBe(id('sun'));
    expect(result.cycle).toBe(false);
  });

  it('detects a cycle formed by mutual reception', () => {
    // Mars in Gemini (ruled by Mercury), Mercury in Aries (ruled by Mars).
    const positions = new Map([
      [id('mars'), 2 * 30 + 5],
      [id('mercury'), 5],
    ]);
    const result = dispositorChain(id('mars'), positions);
    expect(result.chain).toEqual([id('mars'), id('mercury')]);
    expect(result.finalDispositor).toBeUndefined();
    expect(result.cycle).toBe(true);
  });

  it('respects the rulership scheme', () => {
    // Mars in Scorpio: traditional ruler is Mars itself (self-rule); modern
    // ruler is Pluto, so the chain must continue to wherever Pluto sits.
    const traditionalPositions = new Map([[id('mars'), 7 * 30 + 5]]);
    expect(dispositorChain(id('mars'), traditionalPositions, 'traditional').finalDispositor).toBe(id('mars'));

    const modernPositions = new Map([
      [id('mars'), 7 * 30 + 5],
      [id('pluto'), 7 * 30 + 20], // Pluto also in Scorpio: self-rules under modern too.
    ]);
    const modernResult = dispositorChain(id('mars'), modernPositions, 'modern');
    expect(modernResult.chain).toEqual([id('mars'), id('pluto')]);
    expect(modernResult.finalDispositor).toBe(id('pluto'));
  });

  it('throws when a body in the chain has no given position', () => {
    const positions = new Map([[id('moon'), 10]]); // Aries -> Mars, but Mars is missing
    expect(() => dispositorChain(id('moon'), positions)).toThrow(RangeError);
  });
});

describe('isMutualReception (#34)', () => {
  it('is true when two bodies each occupy the sign the other rules', () => {
    // Mars in Gemini (Mercury's sign), Mercury in Aries (Mars's sign).
    expect(isMutualReception(id('mars'), 2 * 30 + 5, id('mercury'), 5)).toBe(true);
  });

  it('is false when only one direction holds', () => {
    // Mercury in Aries (Mars's sign), but Mars in its own sign (Aries too) is not Mercury's.
    expect(isMutualReception(id('mercury'), 5, id('mars'), 10)).toBe(false);
  });

  it('respects the rulership scheme', () => {
    // Venus in Scorpio, Pluto in Taurus: mutual reception only under the modern scheme.
    const venusLongitude = 7 * 30 + 5;
    const plutoLongitude = 1 * 30 + 5;
    expect(isMutualReception(id('venus'), venusLongitude, id('pluto'), plutoLongitude, 'traditional')).toBe(false);
    expect(isMutualReception(id('venus'), venusLongitude, id('pluto'), plutoLongitude, 'modern')).toBe(true);
  });
});
