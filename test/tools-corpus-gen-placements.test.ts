/**
 * Regression coverage for `tools/corpus-gen/lib/placements.mjs`'s `corePairs()` (#395): excludes
 * same-point calculation-method-variant pairs (e.g. interpolatedLilith/meanLilith,
 * meanNode/trueNode) from the aspect-pair/synastry-aspect placement space entirely — two variants
 * of the same real point are always near-conjunct by construction, so an "aspect" between them
 * carries no independent astrological meaning regardless of how it's worded.
 */
import { describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error -- plain .mjs, no type declarations; cast to known shape below.
import { corePairs as corePairsUntyped } from '../tools/corpus-gen/lib/placements.mjs';

const corePairs = corePairsUntyped as () => readonly (readonly [string, string])[];

describe('corePairs (#395)', () => {
  const pairs = corePairs();

  it('excludes every pairing within the Lilith calculation-method family', () => {
    const lilithKeys = ['meanLilith', 'osculatingLilith', 'interpolatedLilith'];
    for (const a of lilithKeys) {
      for (const b of lilithKeys) {
        if (a >= b) continue;
        expect(pairs).not.toContainEqual([a, b]);
      }
    }
  });

  it('excludes the mean/true node pairing', () => {
    expect(pairs).not.toContainEqual(['meanNode', 'trueNode']);
  });

  it('still includes a Lilith variant paired with a genuinely different body', () => {
    expect(pairs).toContainEqual(['mars', 'meanLilith']);
  });

  it('still includes two genuinely different asteroids (same category, not a point-variant family)', () => {
    expect(pairs).toContainEqual(['ceres', 'vesta']);
  });

  it('still includes a node paired with a genuinely different body', () => {
    expect(pairs).toContainEqual(['meanNode', 'venus']);
  });
});
