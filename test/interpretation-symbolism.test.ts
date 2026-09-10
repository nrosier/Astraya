import { describe, expect, it } from 'vitest';
import { BODIES } from '../src/astrology/bodies.js';
import { SIGNS } from '../src/astrology/signs.js';
import { BODY_NAMES, SIGN_NAMES } from '../src/interpretation/compose.js';
import {
  buildSymbolismContext,
  planetSymbolism,
  PLANET_SYMBOLISM,
  PLANET_SYMBOLISM_NL,
  signSymbolism,
  SIGN_SYMBOLISM,
  SIGN_SYMBOLISM_NL,
  VOICE_GUIDE,
  VOICE_GUIDE_NL,
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

describe('Dutch symbolism sheets (#211)', () => {
  it('covers exactly the luminary/planet BODIES entries, no more and no fewer', () => {
    const planetKeys = BODIES.filter((body) => body.category === 'luminary' || body.category === 'planet').map(
      (body) => body.key,
    );
    expect(PLANET_SYMBOLISM_NL.map((entry) => entry.key).sort()).toEqual([...planetKeys].sort());
  });

  it('covers exactly the 12 signs', () => {
    expect(SIGN_SYMBOLISM_NL.map((entry) => entry.index).sort((a, b) => a - b)).toEqual(
      SIGNS.map((sign) => sign.index),
    );
  });

  it('gives every entry a non-empty core description and at least one keyword', () => {
    for (const entry of PLANET_SYMBOLISM_NL) {
      expect(entry.core.trim()).not.toBe('');
      expect(entry.keywords.length).toBeGreaterThan(0);
    }
    for (const entry of SIGN_SYMBOLISM_NL) {
      expect(entry.core.trim()).not.toBe('');
      expect(entry.keywords.length).toBeGreaterThan(0);
    }
  });

  it('has as many voice rules as the English guide', () => {
    expect(VOICE_GUIDE_NL.length).toBe(VOICE_GUIDE.length);
  });

  it('buildSymbolismContext("nl") assembles every Dutch planet and sign name plus the Dutch voice rules', () => {
    const context = buildSymbolismContext('nl');
    for (const body of BODIES.filter((entry) => entry.category === 'luminary' || entry.category === 'planet')) {
      expect(context).toContain(BODY_NAMES.nl[body.key]);
    }
    for (const sign of SIGNS) {
      expect(context).toContain(SIGN_NAMES.nl[sign.index]);
    }
    for (const rule of VOICE_GUIDE_NL) {
      expect(context).toContain(rule);
    }
  });

  it('uses Dutch section headers, not the English ones', () => {
    const context = buildSymbolismContext('nl');
    expect(context).toContain('PLANEETSYMBOLIEK');
    expect(context).toContain('TEKENSYMBOLIEK');
    expect(context).toContain('STEM- EN TOONREGELS');
    expect(context).not.toContain('PLANET SYMBOLISM');
  });

  it('is stable across calls (pure, no hidden state)', () => {
    expect(buildSymbolismContext('nl')).toBe(buildSymbolismContext('nl'));
  });

  it('produces different text than the English context', () => {
    expect(buildSymbolismContext('nl')).not.toBe(buildSymbolismContext('en'));
  });
});
