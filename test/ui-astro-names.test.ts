import { describe, expect, it } from 'vitest';
import { SIGNS } from '../src/astrology/signs.js';
import { BODIES } from '../src/astrology/bodies.js';
import { ASPECTS } from '../src/astrology/aspects.js';
import {
  aspectDisplayName,
  bodyDisplayName,
  signDisplayName,
  signNamesMessages,
  bodyNamesMessages,
  aspectNamesMessages,
} from '../src/ui/astro-names.messages.js';

describe('signDisplayName', () => {
  it('has an entry for every sign the domain layer defines', () => {
    for (const sign of SIGNS) {
      expect(signNamesMessages.en).toHaveProperty(sign.name);
    }
  });

  it('translates every sign into Dutch', () => {
    expect(signDisplayName('Aries', 'nl')).toBe('Ram');
    expect(signDisplayName('Pisces', 'nl')).toBe('Vissen');
  });

  it('passes English through unchanged', () => {
    expect(signDisplayName('Leo', 'en')).toBe('Leo');
  });

  it('falls back to the identifier itself for an unknown sign', () => {
    expect(signDisplayName('Ophiuchus', 'nl')).toBe('Ophiuchus');
  });
});

describe('bodyDisplayName', () => {
  it('has an entry for every body the domain layer defines, plus the asc/mc pseudo-bodies', () => {
    for (const body of BODIES) {
      expect(bodyNamesMessages.en).toHaveProperty(body.key);
    }
    expect(bodyNamesMessages.en).toHaveProperty('asc');
    expect(bodyNamesMessages.en).toHaveProperty('mc');
  });

  it('translates a body key into Dutch', () => {
    expect(bodyDisplayName('sun', 'nl')).toBe('Zon');
    expect(bodyDisplayName('mc', 'nl')).toBe('Hemelmidden');
  });

  it('falls back to the key itself for an unknown body', () => {
    expect(bodyDisplayName('vulcan', 'nl')).toBe('vulcan');
  });
});

describe('aspectDisplayName', () => {
  it('has an entry for every aspect the domain layer defines', () => {
    for (const aspect of ASPECTS) {
      expect(aspectNamesMessages.en).toHaveProperty(aspect.key);
    }
  });

  it('translates an aspect key into Dutch', () => {
    expect(aspectDisplayName('conjunction', 'nl')).toBe('Conjunctie');
    expect(aspectDisplayName('opposition', 'nl')).toBe('Oppositie');
  });

  it('falls back to the key itself for an unknown aspect', () => {
    expect(aspectDisplayName('parallel', 'nl')).toBe('parallel');
  });
});
