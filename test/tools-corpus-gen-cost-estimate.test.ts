/**
 * Regression coverage for `tools/corpus-gen/lib/cost-estimate.mjs`: batch-tier cost estimation
 * for evaluate-corpus-batch.mjs and improve-corpus-batch.mjs.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs, no type declarations; cast to known shapes below.
import { estimateBatchCostCents as estimateBatchCostCentsUntyped, formatCents as formatCentsUntyped } from '../tools/corpus-gen/lib/cost-estimate.mjs';

const estimateBatchCostCents = estimateBatchCostCentsUntyped as (
  model: string,
  promptTokens: number,
  outputTokens: number,
) => number | undefined;
const formatCents = formatCentsUntyped as (cents: number) => string;

describe('estimateBatchCostCents', () => {
  it('computes cost from a known model’s batch per-1M-token rates', () => {
    // gpt-6-luna: $0.05 input / $0.25 output per 1M tokens, i.e. 5 / 25 cents per 1M.
    expect(estimateBatchCostCents('gpt-6-luna', 1_000_000, 1_000_000)).toBeCloseTo(30, 5);
  });

  it('returns undefined for a model not in the pricing table', () => {
    expect(estimateBatchCostCents('not-a-real-model', 100, 100)).toBeUndefined();
  });

  it('returns undefined for non-finite token counts', () => {
    expect(estimateBatchCostCents('gpt-6-luna', NaN, 10)).toBeUndefined();
    expect(estimateBatchCostCents('gpt-6-luna', 10, Infinity)).toBeUndefined();
  });

  it('returns 0 for zero usage', () => {
    expect(estimateBatchCostCents('gpt-6-luna', 0, 0)).toBe(0);
  });
});

describe('formatCents', () => {
  it('formats cents as a dollar string with 4 decimal places', () => {
    expect(formatCents(30)).toBe('$0.3000');
    expect(formatCents(0.0654)).toBe('$0.0007');
  });
});
