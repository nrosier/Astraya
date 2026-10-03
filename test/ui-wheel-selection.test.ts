import { describe, expect, it } from 'vitest';
import type { CorpusPlacement } from '../src/interpretation/schema.js';
import { chartViewMessages } from '../src/ui/ChartView.messages.js';
import { placementHeading, SELECTION_TEXT_LIMIT } from '../src/ui/wheel-selection.js';

const labelsFor = (locale: 'en' | 'nl') => {
  const t = chartViewMessages[locale];
  return { house: t.houseLabel, dignityStates: t.dignityStateLabels, cuspOf: t.cuspHeading };
};

const heading = (placement: CorpusPlacement, locale: 'en' | 'nl' = 'en'): string | undefined =>
  placementHeading(placement, locale, labelsFor(locale));

describe('placementHeading (#415)', () => {
  it('names a planet in a sign', () => {
    expect(heading({ category: 'planet-in-sign', body: 'sun', sign: 9 })).toBe('Sun — Capricorn');
    expect(heading({ category: 'planet-in-sign', body: 'moon', sign: 6 }, 'nl')).toBe('Maan — Weegschaal');
  });

  it('names a planet in a house', () => {
    expect(heading({ category: 'planet-in-house', body: 'venus', house: 4 })).toBe('Venus — House 4');
    expect(heading({ category: 'planet-in-house', body: 'venus', house: 4 }, 'nl')).toBe('Venus — Huis 4');
  });

  it('names a dignity in words', () => {
    expect(heading({ category: 'dignity-state', body: 'sun', state: 'exalted' })).toBe('Sun — Exalted');
    expect(heading({ category: 'dignity-state', body: 'mars', state: 'fall' }, 'nl')).toBe('Mars — Val');
  });

  it('names an aspect as the two bodies around the aspect, in lowercase', () => {
    expect(heading({ category: 'aspect-pair', aspect: 'square', bodyA: 'sun', bodyB: 'moon' })).toBe('Sun square Moon');
    expect(heading({ category: 'aspect-pair', aspect: 'trine', bodyA: 'venus', bodyB: 'mars' }, 'nl')).toMatch(
      /^Venus .+ Mars$/,
    );
  });

  it('names a house cusp by its sign and house', () => {
    expect(heading({ category: 'sign-on-cusp', sign: 6, house: 1 })).toBe('Libra on the cusp of house 1');
    expect(heading({ category: 'sign-on-cusp', sign: 6, house: 1 }, 'nl')).toBe('Weegschaal op de cusp van huis 1');
  });

  it('has no heading for a category the wheel never selects', () => {
    expect(heading({ category: 'profected-house', house: 3 })).toBeUndefined();
    expect(heading({ category: 'pattern', pattern: 'grand-trine' })).toBeUndefined();
  });

  it('wraps a sign index outside 0-11 rather than printing nothing', () => {
    expect(heading({ category: 'planet-in-sign', body: 'sun', sign: 12 })).toBe('Sun — Aries');
  });

  it('keeps a short list short: a limit large enough to read, small enough not to bury the facts', () => {
    expect(SELECTION_TEXT_LIMIT).toBeGreaterThanOrEqual(3);
    expect(SELECTION_TEXT_LIMIT).toBeLessThanOrEqual(12);
  });

  it('words the show-all control with its count, in both languages', () => {
    expect(chartViewMessages.en.selectionShowAll(11)).toContain('11');
    expect(chartViewMessages.nl.selectionShowAll(11)).toContain('11');
  });
});
