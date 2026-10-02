/**
 * Cost estimation for every corpus-gen script that calls an external LLM provider (#382).
 * Despite the `*-batch.mjs` naming convention most of these scripts share, "batch" there mostly
 * means "processes a batch/set of items in a loop" — only evaluate-corpus-batch.mjs,
 * improve-corpus-batch.mjs, and generate-batch.mjs's own `--batch` flag actually use a provider's
 * real Batch API (billed at a separate, lower rate); every other script, and those three outside
 * `--batch` mode, makes synchronous standard-tier calls. Hence two separate pricing tables below,
 * not one with a 0.5 multiplier applied at call time — the discount isn't a clean half for every
 * model (OpenAI's is here, Gemini's is too, but this stays correct if a future model's isn't).
 *
 * Confirmed 2026-10 against:
 * - https://developers.openai.com/api/docs/pricing (gpt-* rows)
 * - https://ai.google.dev/gemini-api/docs/pricing (gemini-* rows; Gemini 3.1 Pro Preview's rate
 *   below is its ≤200k-token-prompt tier — corpus-gen's per-entry prompts never approach that)
 *
 * Verify against those pages before relying on this for a real budget — it exists to print a
 * console estimate after a run, not to be an invoice. The `estimate*CostCents` functions return
 * `undefined` for a model not in the relevant table, so callers can say "cost unknown" instead of
 * silently reporting $0, which would read as "this was free." Ollama is a genuine $0 case though
 * (a local server, not a hosted API) — `estimateCostCentsForCall` returns 0 for it directly,
 * never consulting either table.
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

const STANDARD_PRICING_PER_1M_CENTS = {
  'gpt-6-luna': { input: 10, output: 50 },
  'gpt-5-nano': { input: 5, output: 40 },
  'gpt-5.4-nano': { input: 20, output: 125 },
  'gpt-5.6-luna': { input: 20, output: 120 },
  'gemini-3.5-flash-lite': { input: 30, output: 250 },
  'gemini-3.8-flash': { input: 75, output: 375 },
  'gemini-3.1-pro-preview': { input: 200, output: 1200 },
};

function estimateFromTable(table, model, promptTokens, outputTokens) {
  const pricing = table[model];
  if (pricing === undefined || !Number.isFinite(promptTokens) || !Number.isFinite(outputTokens)) return undefined;
  return (promptTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

/** Cost in cents for one Batch-API call's token usage, or `undefined` if `model` isn't in the batch table above. */
export function estimateBatchCostCents(model, promptTokens, outputTokens) {
  return estimateFromTable(BATCH_PRICING_PER_1M_CENTS, model, promptTokens, outputTokens);
}

/** Cost in cents for one synchronous, standard-tier call's token usage, or `undefined` if `model` isn't in the standard table above. */
export function estimateStandardCostCents(model, promptTokens, outputTokens) {
  return estimateFromTable(STANDARD_PRICING_PER_1M_CENTS, model, promptTokens, outputTokens);
}

/**
 * The one function most corpus-gen scripts should actually call: picks the right table (or $0
 * for Ollama) from the same `provider`/`model`/`tier` values the script already has in scope.
 * `tier` defaults to `'standard'` since that's every script's default call shape; pass
 * `'batch'` only for an actual Batch-API submission (gemini-batch.mjs/openai-batch.mjs).
 */
export function estimateCostCentsForCall({ provider, model, tier = 'standard', promptTokens, outputTokens }) {
  if (provider === 'ollama') return 0;
  return tier === 'batch'
    ? estimateBatchCostCents(model, promptTokens, outputTokens)
    : estimateStandardCostCents(model, promptTokens, outputTokens);
}

/** `$0.0123`-style formatting for a cents value, 4 decimal places since a single corpus entry's cost is well under a cent. */
export function formatCents(cents) {
  return `$${(cents / 100).toFixed(4)}`;
}
