import { describe, expect, it } from 'vitest';
import { BODIES } from '../src/astrology/bodies.js';
import { SIGNS } from '../src/astrology/signs.js';
import {
  buildSymbolismContext,
  planetSymbolism,
  PLANET_SYMBOLISM,
  signSymbolism,
  SIGN_SYMBOLISM,
  VOICE_GUIDE,
} from '../src/interpretation/symbolism.js';

describe('symbolism sheets (#54)', () => {
  it('covers exactly the luminary/planet BODIES entries, no more and no fewer', () => {
    const planetKeys = BODIES.filter((body) => body.category === 'luminary' || body.category === 'planet').map(
      (body) => body.key,
    );
    expect(PLANET_SYMBOLISM.map((entry) => entry.key).sort()).toEqual([...planetKeys].sort());
  });

  it('covers exactly the 12 signs', () => {
    expect(SIGN_SYMBOLISM.map((entry) => entry.index).sort((a, b) => a - b)).toEqual(SIGNS.map((sign) => sign.index));
  });

  it('gives every entry a non-empty core description and at least one keyword', () => {
    for (const entry of PLANET_SYMBOLISM) {
      expect(entry.core.trim()).not.toBe('');
      expect(entry.keywords.length).toBeGreaterThan(0);
    }
    for (const entry of SIGN_SYMBOLISM) {
      expect(entry.core.trim()).not.toBe('');
      expect(entry.keywords.length).toBeGreaterThan(0);
    }
  });

  it('planetSymbolism/signSymbolism look up by key/index', () => {
    expect(planetSymbolism('saturn')?.core).toContain('discipline');
    expect(planetSymbolism('not-a-planet')).toBeUndefined();
    expect(signSymbolism(0)?.core).toBeDefined();
    expect(signSymbolism(99)).toBeUndefined();
  });

  it('has at least one voice rule', () => {
    expect(VOICE_GUIDE.length).toBeGreaterThan(0);
  });

  it('buildSymbolismContext assembles every planet and sign name plus the voice rules', () => {
    const context = buildSymbolismContext();
    for (const body of BODIES.filter((entry) => entry.category === 'luminary' || entry.category === 'planet')) {
      expect(context).toContain(body.name);
    }
    for (const sign of SIGNS) {
      expect(context).toContain(sign.name);
    }
    for (const rule of VOICE_GUIDE) {
      expect(context).toContain(rule);
    }
  });

  it('is stable across calls (pure, no hidden state)', () => {
    expect(buildSymbolismContext()).toBe(buildSymbolismContext());
  });
});
