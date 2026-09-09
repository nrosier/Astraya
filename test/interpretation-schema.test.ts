import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  categoryOfKey,
  CORPUS_ENTRY_RESPONSE_SCHEMA,
  dignityState,
  parsePlacementKey,
  PERSONA_IDS,
  placementKey,
  validateCorpusEntries,
  type CorpusPlacement,
} from '../src/interpretation/schema.js';

const PLACEMENTS: readonly CorpusPlacement[] = [
  { category: 'planet-in-sign', body: 'sun', sign: 0 },
  { category: 'planet-in-house', body: 'moon', house: 10 },
  { category: 'sign-on-cusp', sign: 4, house: 1 },
  { category: 'aspect-pair', aspect: 'square', bodyA: 'mars', bodyB: 'sun' },
  { category: 'dignity-state', body: 'jupiter', state: 'exalted' },
  { category: 'nakshatra', body: 'moon', nakshatra: 3 },
  { category: 'pattern', pattern: 'bowl' },
];

function validEntry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'planet-in-sign:sun:0',
    locale: 'en',
    text: 'The Sun in Aries.',
    tier: 'core',
    tags: ['fire'],
    provenance: { source: 'hand-written' },
    ...overrides,
  };
}

describe('placementKey / parsePlacementKey (#53)', () => {
  it.each(PLACEMENTS)('round-trips %o', (placement) => {
    const key = placementKey(placement);
    expect(parsePlacementKey(key)).toEqual(placement);
  });

  it('canonicalizes aspect-pair bodies alphabetically regardless of input order', () => {
    const forward = placementKey({ category: 'aspect-pair', aspect: 'square', bodyA: 'mars', bodyB: 'sun' });
    const reversed = placementKey({ category: 'aspect-pair', aspect: 'square', bodyA: 'sun', bodyB: 'mars' });
    expect(forward).toBe(reversed);
    expect(forward).toBe('aspect-pair:square:mars:sun');
  });

  it('returns undefined for an unparseable key', () => {
    expect(parsePlacementKey('not-a-real-category:whatever')).toBeUndefined();
    expect(parsePlacementKey('dignity-state:mars:not-a-state')).toBeUndefined();
  });

  it('categoryOfKey reads just the first segment', () => {
    expect(categoryOfKey('planet-in-house:moon:10')).toBe('planet-in-house');
    expect(categoryOfKey('bogus:1:2')).toBeUndefined();
  });
});

describe('dignityState (#53)', () => {
  it('follows ruler > exalted > detriment > fall precedence', () => {
    expect(dignityState({ ruler: true, exalted: true, detriment: false, fall: false })).toBe('ruler');
    expect(dignityState({ ruler: false, exalted: true, detriment: true, fall: false })).toBe('exalted');
    expect(dignityState({ ruler: false, exalted: false, detriment: true, fall: true })).toBe('detriment');
    expect(dignityState({ ruler: false, exalted: false, detriment: false, fall: true })).toBe('fall');
  });

  it('returns undefined when no dignity applies', () => {
    expect(dignityState({ ruler: false, exalted: false, detriment: false, fall: false })).toBeUndefined();
  });
});

describe('validateCorpusEntries (#53)', () => {
  it('accepts a well-formed entry', () => {
    const result = validateCorpusEntries([validEntry()]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entries).toHaveLength(1);
  });

  it('rejects an unknown body key', () => {
    const result = validateCorpusEntries([validEntry({ key: 'planet-in-sign:notabody:0' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/unknown body key/);
  });

  it('rejects a sign index out of range', () => {
    const result = validateCorpusEntries([validEntry({ key: 'planet-in-sign:sun:12' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/out of range/);
  });

  it('rejects a non-canonical (out-of-order) aspect-pair key', () => {
    const result = validateCorpusEntries([validEntry({ key: 'aspect-pair:square:sun:mars' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/alphabetical order/);
  });

  it('rejects an unknown aspect key', () => {
    const result = validateCorpusEntries([validEntry({ key: 'aspect-pair:not-an-aspect:mars:sun' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/unknown aspect key/);
  });

  it('rejects an aspect-pair entry with identical bodies', () => {
    const result = validateCorpusEntries([validEntry({ key: 'aspect-pair:square:sun:sun' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/both "sun"/);
  });

  it('rejects a non-kebab-case pattern key', () => {
    const result = validateCorpusEntries([validEntry({ key: 'pattern:Bowl_Shape' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });

  it('rejects an invalid locale, tier, empty text and malformed tags', () => {
    const result = validateCorpusEntries([
      validEntry({ locale: 'fr', tier: 'legendary', text: '   ', tags: ['ok', 42] }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const messages = result.issues.map((issue) => issue.message);
      expect(messages.some((message) => message.includes('locale must be one of'))).toBe(true);
      expect(messages.some((message) => message.includes('tier must be one of'))).toBe(true);
      expect(messages.some((message) => message.includes('text must be a non-empty string'))).toBe(true);
      expect(messages.some((message) => message.includes('tags must be an array of strings'))).toBe(true);
    }
  });

  it('rejects an invalid provenance shape', () => {
    const result = validateCorpusEntries([validEntry({ provenance: { source: 'made-up' } })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/provenance.source/);
  });

  it('accepts generated provenance with model/promptVersion/generatedAt fields', () => {
    const result = validateCorpusEntries([
      validEntry({
        provenance: {
          source: 'generated',
          model: 'gemini-2.5-pro',
          promptVersion: 'corpus-generator-v1',
          generatedAt: '2026-09-09',
        },
      }),
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects a non-string promptVersion', () => {
    const result = validateCorpusEntries([validEntry({ provenance: { source: 'generated', promptVersion: 42 } })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/provenance.promptVersion/);
  });

  it('rejects duplicate keys within the array', () => {
    const result = validateCorpusEntries([validEntry(), validEntry()]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.message.includes('duplicate key'))).toBe(true);
  });

  it('rejects a non-object entry', () => {
    const result = validateCorpusEntries(['not an object']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toBe('entry must be an object');
  });

  it('accepts an empty array', () => {
    const result = validateCorpusEntries([]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entries).toHaveLength(0);
  });
});

describe('validateCorpusEntries persona (#211)', () => {
  it('rejects an unknown persona id', () => {
    const result = validateCorpusEntries([validEntry({ persona: 'astrologer-supreme' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/persona must be one of/);
  });

  it('accepts a known persona id and includes it on the entry', () => {
    const result = validateCorpusEntries([validEntry({ persona: 'mystic' })]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entries[0]?.persona).toBe('mystic');
  });

  it('allows the same key for a neutral entry and a persona entry', () => {
    const result = validateCorpusEntries([validEntry(), validEntry({ persona: 'cynic' })]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entries).toHaveLength(2);
  });

  it('allows the same key for two different personas', () => {
    const result = validateCorpusEntries([validEntry({ persona: 'mystic' }), validEntry({ persona: 'cynic' })]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entries).toHaveLength(2);
  });

  it('rejects duplicate (key, persona) pairs', () => {
    const result = validateCorpusEntries([validEntry({ persona: 'mystic' }), validEntry({ persona: 'mystic' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((issue) => issue.message.includes('duplicate key') && issue.message.includes('mystic'))).toBe(
        true,
      );
    }
  });
});

describe('validateCorpusEntries anchor (#211)', () => {
  it('accepts a hand-written anchor', () => {
    const result = validateCorpusEntries([validEntry({ anchor: true, provenance: { source: 'hand-written' } })]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entries[0]?.anchor).toBe(true);
  });

  it('rejects a generated anchor with no review', () => {
    const result = validateCorpusEntries([
      validEntry({ anchor: true, provenance: { source: 'generated', model: 'gemini-2.5-pro' } }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/hand-written, or generated and reviewed/);
  });

  it('accepts a generated anchor once reviewed', () => {
    const result = validateCorpusEntries([
      validEntry({
        anchor: true,
        provenance: { source: 'generated', model: 'gemini-2.5-pro', reviewedBy: 'user', reviewedAt: '2026-09-09' },
      }),
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects an anchor that also declares a persona', () => {
    const result = validateCorpusEntries([
      validEntry({ anchor: true, persona: 'mystic', provenance: { source: 'hand-written' } }),
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.some((issue) => issue.message.includes('must not declare a persona'))).toBe(true);
  });

  it('rejects a non-boolean anchor value', () => {
    const result = validateCorpusEntries([validEntry({ anchor: 'yes' })]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toMatch(/anchor must be a boolean/);
  });
});

describe('CORPUS_ENTRY_RESPONSE_SCHEMA (#211)', () => {
  it('no longer requires (or defines) tags — tags are derived mechanically, not model-invented', () => {
    expect(CORPUS_ENTRY_RESPONSE_SCHEMA.required).not.toContain('tags');
    expect(Object.keys(CORPUS_ENTRY_RESPONSE_SCHEMA.properties)).not.toContain('tags');
  });
});

describe('PERSONA_IDS stays in sync with tools/corpus-gen/personas.json (#211)', () => {
  it('matches exactly, in any order', async () => {
    const raw = await readFile(new URL('../tools/corpus-gen/personas.json', import.meta.url), 'utf8');
    const personas = (JSON.parse(raw) as { personas: readonly { id: string }[] }).personas;
    const fileIds = personas.map((persona) => persona.id).slice().sort();
    expect(fileIds).toEqual([...PERSONA_IDS].sort());
  });
});
