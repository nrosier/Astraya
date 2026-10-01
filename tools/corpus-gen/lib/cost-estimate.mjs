/**
 * Batch-tier cost estimation for corpus-gen's always-batch scripts (evaluate-corpus-batch.mjs,
 * improve-corpus-batch.mjs). Both OpenAI's and Gemini's batch APIs bill well under their
 * standard per-token rate (confirmed via each provider's own pricing page, not assumed to be an
 * exact half across the board — Gemini's is, OpenAI's is for the models below too, but this
 * table stores the real batch figure directly rather than a standard rate + a 0.5 multiplier, so
 * it stays correct even where a provider's discount isn't a clean half).
 *
 * Confirmed 2026-10 against:
 * - https://developers.openai.com/api/docs/pricing (gpt-* rows)
 * - https://ai.google.dev/gemini-api/docs/pricing (gemini-* rows; Gemini 3.1 Pro Preview's rate
 *   below is its ≤200k-token-prompt tier — corpus-gen's per-entry prompts never approach that)
 *
 * Verify against those pages before relying on this for a real budget — it exists to print a
 * console estimate after a run, not to be an invoice. `estimateBatchCostCents` returns
 * `undefined` for a model not in this table so callers can say "cost unknown" instead of
 * silently reporting $0, which would read as "this was free."
 */
const BATCH_PRICING_PER_1M_CENTS = {
  'gpt-6-luna': { input: 5, output: 25 },
  'gpt-5-nano': { input: 2.5, output: 20 },
  'gpt-5.4-nano': { input: 10, output: 62.5 },
  'gpt-5.6-luna': { input: 10, output: 60 },
  'gemini-3.5-flash-lite': { input: 15, output: 125 },
  'gemini-3.8-flash': { input: 37.5, output: 187.5 },
  'gemini-3.1-pro-preview': { input: 100, output: 600 },
};

/** Cost in cents for one call's token usage, or `undefined` if `model` isn't in the table above. */
export function estimateBatchCostCents(model, promptTokens, outputTokens) {
  const pricing = BATCH_PRICING_PER_1M_CENTS[model];
  if (pricing === undefined || !Number.isFinite(promptTokens) || !Number.isFinite(outputTokens)) return undefined;
  return (promptTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/** `$0.0123`-style formatting for a cents value, 4 decimal places since a single corpus entry's cost is well under a cent. */
export function formatCents(cents) {
  return `$${(cents / 100).toFixed(4)}`;
}
