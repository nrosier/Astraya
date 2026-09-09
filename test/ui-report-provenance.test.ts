import { describe, expect, it } from 'vitest';
import {
  describeFactors,
  describeParagraphProvenance,
  describePlacement,
  describeSource,
} from '../src/ui/report-provenance.js';
import type { ReportParagraph } from '../src/interpretation/report.js';
import type { CorpusEntry } from '../src/interpretation/schema.js';

describe('describePlacement (#62)', () => {
  it('describes a planet-in-sign placement', () => {
    expect(describePlacement({ category: 'planet-in-sign', body: 'sun', sign: 0 })).toBe('Sun in Aries');
  });

  it('describes a planet-in-house placement', () => {
    expect(describePlacement({ category: 'planet-in-house', body: 'moon', house: 4 })).toBe('Moon in house 4');
  });

  it('describes a sign-on-cusp placement', () => {
    expect(describePlacement({ category: 'sign-on-cusp', sign: 6, house: 7 })).toBe('Libra on the house 7 cusp');
  });

  it('describes an aspect-pair placement', () => {
    expect(describePlacement({ category: 'aspect-pair', aspect: 'square', bodyA: 'mars', bodyB: 'sun' })).toBe(
      'Mars square Sun',
    );
  });

  it('describes a dignity-state placement', () => {
    expect(describePlacement({ category: 'dignity-state', body: 'jupiter', state: 'exalted' })).toBe(
      'Jupiter: exalted',
    );
  });

  it('falls back to the key itself for an unknown body or aspect key', () => {
    expect(describePlacement({ category: 'planet-in-sign', body: 'notabody', sign: 0 })).toBe('notabody in Aries');
  });
});

describe('describeSource (#62)', () => {
  it('labels a hand-written corpus entry', () => {
    const entry: CorpusEntry = {
      key: 'planet-in-sign:sun:0',
      locale: 'en',
      text: 'x',
      tier: 'core',
      tags: [],
      provenance: { source: 'hand-written' },
    };
    expect(describeSource({ kind: 'corpus', entry })).toBe('Hand-written corpus entry');
  });

  it('includes model, prompt version and date for a generated corpus entry', () => {
    const entry: CorpusEntry = {
      key: 'planet-in-sign:sun:0',
      locale: 'en',
      text: 'x',
      tier: 'core',
      tags: [],
      provenance: {
        source: 'generated',
        model: 'gemini-2.5-pro',
        promptVersion: 'corpus-generator-v1',
        generatedAt: '2026-09-09',
      },
    };
    const description = describeSource({ kind: 'corpus', entry });
    expect(description).toContain('gemini-2.5-pro');
    expect(description).toContain('corpus-generator-v1');
    expect(description).toContain('2026-09-09');
  });

  it('labels a fallback paragraph as having no corpus entry yet', () => {
    expect(describeSource({ kind: 'fallback' })).toMatch(/no corpus entry/);
  });

  it('labels a derived paragraph as not a corpus placement', () => {
    expect(describeSource({ kind: 'derived' })).toMatch(/not a corpus placement/);
  });
});

describe('describeFactors (#62)', () => {
  it('returns undefined for an empty factor list', () => {
    expect(describeFactors([])).toBeUndefined();
  });

  it('joins multiple factors with rule, detail and weight', () => {
    const description = describeFactors([
      { rule: 'dignity', weight: 2, detail: 'ruler' },
      { rule: 'angularity', weight: 1.5, detail: '3.2° from an angle' },
    ]);
    expect(description).toContain('dignity: ruler (weight 2)');
    expect(description).toContain('angularity: 3.2° from an angle (weight 1.5)');
  });
});

describe('describeParagraphProvenance (#62)', () => {
  it('omits placement and factors when the paragraph has neither', () => {
    const paragraph: ReportParagraph = { text: 'x', source: { kind: 'derived' }, factors: [] };
    expect(describeParagraphProvenance(paragraph)).toEqual({
      source: 'Derived directly from chart data, not a corpus placement',
      placement: undefined,
      factors: undefined,
    });
  });

  it('includes placement and factors when the paragraph has both', () => {
    const paragraph: ReportParagraph = {
      text: 'x',
      source: { kind: 'fallback' },
      placement: { category: 'planet-in-sign', body: 'sun', sign: 0 },
      factors: [{ rule: 'dignity', weight: 1, detail: 'ruler' }],
    };
    const provenance = describeParagraphProvenance(paragraph);
    expect(provenance.placement).toBe('Sun in Aries');
    expect(provenance.factors).toContain('dignity: ruler (weight 1)');
  });
});
