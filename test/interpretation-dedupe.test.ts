import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  findNearDuplicates,
  formatSimilarityReport,
} from '../src/interpretation/dedupe.js';
import { CORPUS } from '../src/interpretation/index.js';
import type { CorpusEntry } from '../src/interpretation/schema.js';

function entry(key: string, text: string, overrides: Partial<CorpusEntry> = {}): CorpusEntry {
  return {
    key,
    locale: 'en',
    text,
    tier: 'core',
    tags: [],
    provenance: { source: 'hand-written' },
    ...overrides,
  };
}

const TEXT_A = 'A restless curiosity colours how you show up: quick to notice options, quicker to talk them through.';
const TEXT_B = 'A steady patience colours how you show up: slow to commit, but firm once you finally do.';

describe('findNearDuplicates (#58)', () => {
  it('flags nothing when every entry reads differently', () => {
    const report = findNearDuplicates([entry('a', TEXT_A), entry('b', TEXT_B)]);
    expect(report.pairs).toEqual([]);
  });

  it('flags a pair that repeats the same sentence with only a word or two changed', () => {
    const near = entry(
      'a2',
      'A restless curiosity colours how you show up: quick to notice options, quicker to act on them.',
    );
    const report = findNearDuplicates([entry('a', TEXT_A), near]);
    expect(report.pairs).toHaveLength(1);
    expect(report.pairs[0]).toMatchObject({ keyA: 'a', keyB: 'a2' });
    expect(report.pairs[0]?.similarity).toBeGreaterThanOrEqual(DEFAULT_SIMILARITY_THRESHOLD);
  });

  it('flags an exact repeat at similarity 1', () => {
    const report = findNearDuplicates([entry('a', TEXT_A), entry('a-copy', TEXT_A)]);
    expect(report.pairs).toEqual([{ keyA: 'a', keyB: 'a-copy', locale: 'en', similarity: 1 }]);
  });

  it('never compares an entry across locales', () => {
    // en/nl are meant to say the same thing, so a translated pair sharing high
    // similarity would just be the loader's cross-locale parity check restated —
    // not a signal that the corpus reads as templated.
    const report = findNearDuplicates([entry('a', TEXT_A), entry('a', TEXT_A, { locale: 'nl' })]);
    expect(report.pairs).toEqual([]);
  });

  it('respects a custom threshold', () => {
    const report = findNearDuplicates([entry('a', TEXT_A), entry('b', TEXT_B)], 0.1);
    expect(report.pairs.length).toBeGreaterThan(0);
  });

  it('orders pairs from most to least similar', () => {
    const report = findNearDuplicates(
      [
        entry('a', TEXT_A),
        entry('a-loose', 'A restless curiosity is how you show up here, ready to talk through most options.'),
        entry('a-tight', 'A restless curiosity colours how you show up: quick to notice options, quicker to act.'),
      ],
      0.3,
    );
    const similarities = report.pairs.map((pair) => pair.similarity);
    expect(similarities).toEqual([...similarities].sort((left, right) => right - left));
  });

  it('does not compare an entry against itself', () => {
    const report = findNearDuplicates([entry('a', TEXT_A)]);
    expect(report.pairs).toEqual([]);
  });

  it(
    'the shipped corpus has no near-duplicates',
    () => {
      // Empty until #55/#56 land, so this passes trivially today — it starts
      // failing the moment two entries in the same locale read too much alike.
      // The corpus is now ~33k entries across both locales, and this check is
      // quadratic in entries-per-locale, so it needs far more than vitest's
      // default 30s test timeout to actually finish.
      expect(findNearDuplicates(CORPUS).pairs).toEqual([]);
    },
    30 * 60 * 1000,
  );
});

describe('formatSimilarityReport (#58)', () => {
  it('says plainly when nothing was found', () => {
    expect(formatSimilarityReport({ threshold: 0.7, pairs: [] })).toBe(
      'No near-duplicates found at similarity >= 0.7.',
    );
  });

  it('lists every pair with its locale and percentage', () => {
    const text = formatSimilarityReport({
      threshold: 0.7,
      pairs: [{ keyA: 'a', keyB: 'b', locale: 'en', similarity: 0.842 }],
    });
    expect(text).toContain('84.2%');
    expect(text).toContain('[en]');
    expect(text).toContain('a  <->  b');
  });
});
