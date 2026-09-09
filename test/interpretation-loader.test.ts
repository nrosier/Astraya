import { describe, expect, it } from 'vitest';
import { loadCorpus } from '../src/interpretation/loader.js';

function entry(key: string, locale: 'en' | 'nl', overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key,
    locale,
    text: `text for ${key} (${locale})`,
    tier: 'core',
    tags: [],
    provenance: { source: 'hand-written' },
    ...overrides,
  };
}

describe('loadCorpus (#53)', () => {
  it('combines both locales when every key exists in both', () => {
    const combined = loadCorpus({
      en: [entry('planet-in-sign:sun:0', 'en')],
      nl: [entry('planet-in-sign:sun:0', 'nl')],
    });
    expect(combined).toHaveLength(2);
  });

  it('returns an empty corpus for two empty locales', () => {
    expect(loadCorpus({ en: [], nl: [] })).toEqual([]);
  });

  it('throws when a key exists in en but not nl', () => {
    expect(() => loadCorpus({ en: [entry('planet-in-sign:sun:0', 'en')], nl: [] })).toThrow(
      /exists in locale "en" but not in "nl"/,
    );
  });

  it('throws when a key exists in nl but not en', () => {
    expect(() => loadCorpus({ en: [], nl: [entry('planet-in-sign:sun:0', 'nl')] })).toThrow(
      /exists in locale "nl" but not in "en"/,
    );
  });

  it("throws when an entry's own locale field doesn't match the file it came from", () => {
    expect(() =>
      loadCorpus({
        en: [entry('planet-in-sign:sun:0', 'nl')],
        nl: [entry('planet-in-sign:sun:0', 'nl')],
      }),
    ).toThrow(/declares locale "nl", expected "en"/);
  });

  it('throws with every per-entry validation issue included, across both locales', () => {
    expect(() =>
      loadCorpus({
        en: [entry('planet-in-sign:notabody:0', 'en')],
        nl: [entry('planet-in-sign:sun:99', 'nl')],
      }),
    ).toThrow(/\[en\].*unknown body key[\s\S]*\[nl\].*out of range/);
  });

  it('skips the cross-locale check for a locale that already failed its own validation', () => {
    expect(() =>
      loadCorpus({
        en: [entry('planet-in-sign:notabody:0', 'en')],
        nl: [],
      }),
    ).not.toThrow(/exists in locale/);
  });
});

describe('loadCorpus persona parity (#211)', () => {
  it('combines a neutral entry and a persona entry present in both locales', () => {
    const combined = loadCorpus({
      en: [entry('planet-in-sign:sun:0', 'en'), entry('planet-in-sign:sun:0', 'en', { persona: 'mystic' })],
      nl: [entry('planet-in-sign:sun:0', 'nl'), entry('planet-in-sign:sun:0', 'nl', { persona: 'mystic' })],
    });
    expect(combined).toHaveLength(4);
  });

  it('throws when a persona-specific entry exists in en but not nl, even though the neutral entry matches', () => {
    expect(() =>
      loadCorpus({
        en: [entry('planet-in-sign:sun:0', 'en'), entry('planet-in-sign:sun:0', 'en', { persona: 'mystic' })],
        nl: [entry('planet-in-sign:sun:0', 'nl')],
      }),
    ).toThrow(/key "planet-in-sign:sun:0" for persona "mystic" exists in locale "en" but not in "nl"/);
  });
});
