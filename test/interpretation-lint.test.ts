import { describe, expect, it } from 'vitest';
import { lintCorpus, lintEntry, MAX_LENGTH, MIN_LENGTH } from '../src/interpretation/lint.js';
import { CORPUS } from '../src/interpretation/index.js';
import type { CorpusEntry } from '../src/interpretation/schema.js';

function entry(text: string, overrides: Partial<CorpusEntry> = {}): CorpusEntry {
  return {
    key: 'planet-in-sign:sun:0',
    locale: 'en',
    text,
    tier: 'core',
    tags: [],
    provenance: { source: 'hand-written' },
    ...overrides,
  };
}

const CLEAN_TEXT =
  'A restless curiosity colours how you show up: quick to notice options, quicker still to talk them through out loud.';

describe('lintEntry (#57)', () => {
  it('passes a clean entry with no issues', () => {
    expect(lintEntry(entry(CLEAN_TEXT))).toEqual([]);
  });

  it('flags text below the minimum length', () => {
    const issues = lintEntry(entry('Too short.'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: 'length' });
  });

  it('flags text over the maximum length', () => {
    const issues = lintEntry(entry('x'.repeat(MAX_LENGTH + 1)));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: 'length' });
  });

  it('accepts text at exactly the length bounds', () => {
    expect(lintEntry(entry('x'.repeat(MIN_LENGTH)))).toEqual([]);
    expect(lintEntry(entry('x'.repeat(MAX_LENGTH)))).toEqual([]);
  });

  it('flags fatalistic phrasing', () => {
    const issues = lintEntry(entry(`${CLEAN_TEXT} You will never change this about yourself.`));
    expect(issues.some((issue) => issue.rule === 'fatalistic-phrasing')).toBe(true);
  });

  it('flags a medical, legal or financial claim', () => {
    const issues = lintEntry(entry(`${CLEAN_TEXT} A good therapist could diagnose why.`));
    expect(issues.some((issue) => issue.rule === 'medical-legal-financial-claim')).toBe(true);
  });

  it('flags a gendered pronoun about the reader', () => {
    const issues = lintEntry(entry(`${CLEAN_TEXT} Whenever he feels unheard, this placement shows itself.`));
    expect(issues.some((issue) => issue.rule === 'gendered-assumption')).toBe(true);
  });

  it('does not mistake a capitalised proper noun for a gendered pronoun', () => {
    // "His" the proper noun (a name, a place) is not what this rule exists to catch —
    // only the lowercase third-person pronoun does, and only as a whole word.
    expect(lintEntry(entry(`${CLEAN_TEXT} History rhymes with itself here.`))).toEqual([]);
  });

  it('reports every rule an entry breaks, not just the first', () => {
    const issues = lintEntry(entry('you will never diagnose he'));
    const rules = issues.map((issue) => issue.rule).sort();
    expect(rules).toEqual(['fatalistic-phrasing', 'gendered-assumption', 'length', 'medical-legal-financial-claim']);
  });
});

describe('lintCorpus (#57)', () => {
  it('skips the opening-variety check below the minimum sample size', () => {
    const entries = Array.from({ length: 19 }, (_, index) =>
      entry(`Quietly, ${CLEAN_TEXT}`, { key: `k${String(index)}` }),
    );
    expect(lintCorpus(entries)).toEqual([]);
  });

  it('flags a shared opening once enough entries repeat it', () => {
    const repeated = Array.from({ length: 5 }, (_, index) =>
      entry(`Quietly, ${CLEAN_TEXT}`, { key: `q${String(index)}` }),
    );
    // Each of these needs a distinct opening word, or the test would just be
    // re-triggering the rule it means to hold constant.
    const openings = [
      'Boldly',
      'Carefully',
      'Deliberately',
      'Eagerly',
      'Firmly',
      'Gently',
      'Honestly',
      'Instinctively',
      'Joyfully',
      'Keenly',
      'Loosely',
      'Mindfully',
      'Naturally',
      'Openly',
      'Patiently',
    ];
    const varied = openings.map((opening, index) => entry(`${opening}, ${CLEAN_TEXT}`, { key: `v${String(index)}` }));
    const issues = lintCorpus([...repeated, ...varied]);
    const flaggedKeys = new Set(
      issues.filter((issue) => issue.rule === 'repetitive-openings').map((issue) => issue.key),
    );
    expect(flaggedKeys).toEqual(new Set(repeated.map((item) => item.key)));
  });

  it('the shipped corpus is clean', () => {
    // Empty until #55/#56 land, so this passes trivially today — the point is that
    // it starts failing the moment content that breaks a rule is added, rather than
    // being wired up only after there is something to catch.
    expect(lintCorpus(CORPUS)).toEqual([]);
  });
});
