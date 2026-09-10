import { describe, expect, it } from 'vitest';
import { composeFallbackText, resolvePlacementText } from '../src/interpretation/compose.js';
import { BODIES } from '../src/astrology/bodies.js';
import { ASPECTS } from '../src/astrology/aspects.js';
import { SIGNS } from '../src/astrology/signs.js';
import { CORPUS, CORPUS_LOCALES, DIGNITY_STATES } from '../src/interpretation/index.js';
import type { CorpusEntry, CorpusPlacement, Locale } from '../src/interpretation/schema.js';

const HOUSES = Array.from({ length: 12 }, (_, index) => index + 1);
const SIGN_INDICES = SIGNS.map((sign) => sign.index);

/** Every unique pair of distinct bodies, in the alphabetical order `aspect-pair` requires. */
function canonicalBodyPairs(): readonly (readonly [string, string])[] {
  const keys = BODIES.map((body) => body.key).sort();
  const pairs: (readonly [string, string])[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const a = keys[i];
      const b = keys[j];
      if (a !== undefined && b !== undefined) pairs.push([a, b]);
    }
  }
  return pairs;
}

/**
 * Asserts `resolvePlacementText` is non-empty for every placement, checking
 * each locale independently — per #59's checklist, a gap in only one locale
 * must still fail on its own, not be masked by the other locale passing.
 */
function expectFullCoverage(placements: readonly CorpusPlacement[], corpus: readonly CorpusEntry[]): void {
  for (const locale of CORPUS_LOCALES) {
    const empty = placements.filter((placement) => resolvePlacementText(placement, locale, corpus).trim() === '');
    expect(
      empty,
      `[${locale}] placements with no resolvable text: ${empty.map((p) => JSON.stringify(p)).join(', ')}`,
    ).toEqual([]);
  }
}

describe('coverage: no placement resolves to empty (#59)', () => {
  it('covers the full planet x sign cross-product', () => {
    const placements: CorpusPlacement[] = BODIES.flatMap((body) =>
      SIGN_INDICES.map((sign) => ({ category: 'planet-in-sign' as const, body: body.key, sign })),
    );
    expect(placements).toHaveLength(BODIES.length * SIGN_INDICES.length);
    expectFullCoverage(placements, CORPUS);
  });

  it('covers the full planet x house cross-product', () => {
    const placements: CorpusPlacement[] = BODIES.flatMap((body) =>
      HOUSES.map((house) => ({ category: 'planet-in-house' as const, body: body.key, house })),
    );
    expect(placements).toHaveLength(BODIES.length * HOUSES.length);
    expectFullCoverage(placements, CORPUS);
  });

  it('covers the full sign x house cross-product', () => {
    const placements: CorpusPlacement[] = SIGN_INDICES.flatMap((sign) =>
      HOUSES.map((house) => ({ category: 'sign-on-cusp' as const, sign, house })),
    );
    expect(placements).toHaveLength(SIGN_INDICES.length * HOUSES.length);
    expectFullCoverage(placements, CORPUS);
  });

  it('covers the full aspect x canonical body-pair cross-product', () => {
    const pairs = canonicalBodyPairs();
    const placements: CorpusPlacement[] = ASPECTS.flatMap((aspect) =>
      pairs.map(([bodyA, bodyB]) => ({ category: 'aspect-pair' as const, aspect: aspect.key, bodyA, bodyB })),
    );
    expect(placements).toHaveLength(ASPECTS.length * pairs.length);
    expectFullCoverage(placements, CORPUS);
  });

  it('covers the full body x dignity-state cross-product', () => {
    const placements: CorpusPlacement[] = BODIES.flatMap((body) =>
      DIGNITY_STATES.map((state) => ({ category: 'dignity-state' as const, body: body.key, state })),
    );
    expect(placements).toHaveLength(BODIES.length * DIGNITY_STATES.length);
    expectFullCoverage(placements, CORPUS);
  });
});

describe('composeFallbackText (#59)', () => {
  const locales: readonly Locale[] = CORPUS_LOCALES;

  it('is deterministic: the same placement always composes the same text', () => {
    const placement: CorpusPlacement = { category: 'planet-in-sign', body: 'mars', sign: 0 };
    for (const locale of locales) {
      expect(composeFallbackText(placement, locale)).toBe(composeFallbackText(placement, locale));
    }
  });

  it('produces different text per locale', () => {
    const placement: CorpusPlacement = { category: 'dignity-state', body: 'sun', state: 'ruler' };
    expect(composeFallbackText(placement, 'en')).not.toBe(composeFallbackText(placement, 'nl'));
  });

  it('refuses categories out of scope rather than silently returning something wrong', () => {
    const pattern: CorpusPlacement = { category: 'pattern', pattern: 'grand-trine' };
    expect(() => composeFallbackText(pattern, 'en')).toThrow(/out of scope/);
  });
});

describe('resolvePlacementText (#59)', () => {
  it('prefers a matching corpus entry over the fallback', () => {
    const placement: CorpusPlacement = { category: 'planet-in-sign', body: 'sun', sign: 0 };
    const entry: CorpusEntry = {
      key: 'planet-in-sign:sun:0',
      locale: 'en',
      text: 'A hand-written exemplar for Sun in Aries.',
      tier: 'core',
      tags: [],
      provenance: { source: 'hand-written' },
    };
    expect(resolvePlacementText(placement, 'en', [entry])).toBe(entry.text);
  });

  it('falls back when the corpus has no entry for this key', () => {
    const placement: CorpusPlacement = { category: 'planet-in-sign', body: 'sun', sign: 0 };
    expect(resolvePlacementText(placement, 'en', [])).toBe(composeFallbackText(placement, 'en'));
  });

  it('falls back when the corpus has the key but not this locale', () => {
    const placement: CorpusPlacement = { category: 'planet-in-sign', body: 'sun', sign: 0 };
    const entry: CorpusEntry = {
      key: 'planet-in-sign:sun:0',
      locale: 'en',
      text: 'English only.',
      tier: 'core',
      tags: [],
      provenance: { source: 'hand-written' },
    };
    expect(resolvePlacementText(placement, 'nl', [entry])).toBe(composeFallbackText(placement, 'nl'));
  });

  it('falls back to the mechanical composer when no corpus entry covers the placement', () => {
    const placement: CorpusPlacement = { category: 'planet-in-house', body: 'moon', house: 1 };
    expect(resolvePlacementText(placement, 'en', [])).toBe(composeFallbackText(placement, 'en'));
  });

  it('the shipped corpus now has a real entry for every placement, in every persona', () => {
    expect(CORPUS.length).toBeGreaterThan(0);
    const placement: CorpusPlacement = { category: 'planet-in-house', body: 'moon', house: 1 };
    expect(resolvePlacementText(placement, 'en', CORPUS)).not.toBe(composeFallbackText(placement, 'en'));
  });

  it('falls back to the neutral corpus entry, not the mechanical fallback, when a persona has no dedicated entry', () => {
    const placement: CorpusPlacement = { category: 'planet-in-sign', body: 'sun', sign: 0 };
    const neutral: CorpusEntry = {
      key: 'planet-in-sign:sun:0',
      locale: 'en',
      text: 'The neutral exemplar for Sun in Aries.',
      tier: 'core',
      tags: [],
      provenance: { source: 'hand-written' },
    };
    expect(resolvePlacementText(placement, 'en', [neutral], 'mystic')).toBe(neutral.text);
  });
});
