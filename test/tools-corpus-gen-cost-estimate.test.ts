/**
 * Regression coverage for `tools/corpus-gen/lib/cost-estimate.mjs` (#381/#382): batch- and
 * standard-tier cost estimation for every corpus-gen script that calls an external LLM provider.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs, no type declarations; cast to known shapes below.
import { estimateBatchCostCents as estimateBatchCostCentsUntyped, estimateStandardCostCents as estimateStandardCostCentsUntyped, estimateCostCentsForCall as estimateCostCentsForCallUntyped, formatCents as formatCentsUntyped } from '../tools/corpus-gen/lib/cost-estimate.mjs';

const estimateBatchCostCents = estimateBatchCostCentsUntyped as (
  model: string,
  promptTokens: number,
  outputTokens: number,
) => number | undefined;
const estimateStandardCostCents = estimateStandardCostCentsUntyped as (
  model: string,
  promptTokens: number,
  outputTokens: number,
) => number | undefined;
const estimateCostCentsForCall = estimateCostCentsForCallUntyped as (params: {
  readonly provider: string;
  readonly model: string;
  readonly tier?: 'standard' | 'batch';
  readonly promptTokens: number;
  readonly outputTokens: number;
}) => number | undefined;
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

describe('estimateStandardCostCents', () => {
  it('computes cost from a known model’s standard per-1M-token rates', () => {
    // gpt-6-luna: $0.10 input / $0.50 output per 1M tokens, i.e. 10 / 50 cents per 1M.
    expect(estimateStandardCostCents('gpt-6-luna', 1_000_000, 1_000_000)).toBeCloseTo(60, 5);
  });

  it('is more expensive than the same model’s batch rate', () => {
    const standard = estimateStandardCostCents('gemini-3.5-flash-lite', 1000, 1000) ?? 0;
    const batch = estimateBatchCostCents('gemini-3.5-flash-lite', 1000, 1000) ?? 0;
    expect(standard).toBeGreaterThan(batch);
  });

  it('returns undefined for a model not in the pricing table', () => {
    expect(estimateStandardCostCents('not-a-real-model', 100, 100)).toBeUndefined();
  });
});

describe('estimateCostCentsForCall', () => {
  it('returns 0 for ollama regardless of model or tier', () => {
    expect(
      estimateCostCentsForCall({
        provider: 'ollama',
        model: 'anything',
        promptTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(0);
  });

  it('defaults to standard-tier pricing when tier is omitted', () => {
    expect(
      estimateCostCentsForCall({
        provider: 'gemini',
        model: 'gpt-6-luna',
        promptTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(estimateStandardCostCents('gpt-6-luna', 1_000_000, 1_000_000));
  });

  it('uses batch-tier pricing when tier is "batch"', () => {
    expect(
      estimateCostCentsForCall({
        provider: 'gemini',
        model: 'gpt-6-luna',
        tier: 'batch',
        promptTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe(estimateBatchCostCents('gpt-6-luna', 1_000_000, 1_000_000));
  });
});

describe('formatCents', () => {
  it('formats cents as a dollar string with 4 decimal places', () => {
    expect(formatCents(30)).toBe('$0.3000');
    expect(formatCents(0.0654)).toBe('$0.0007');
  });
});
