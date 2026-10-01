/**
 * Language-quality triage pass: asks a judge model to proofread each entry's
 * text for its own declared locale and classify it GOOD (no change needed),
 * FIXED (a small, high-confidence mechanical correction was made — a typo, a
 * Dutch d/t-fout, missing standard punctuation), or BAD (wrong language
 * entirely, or a problem the judge isn't confident how to fix).
 *
 * FIXED entries have `text` replaced with the judge's `correctedText` and
 * gain the `spelling-corrected-by-judge` tag, so a corrected entry stays
 * auditable and distinguishable from one that shipped as originally
 * generated. BAD entries are left untouched but gain
 * `language-quality-flagged-by-judge` — this script never deletes or
 * rewrites a BAD entry itself, same non-destructive triage-signal pattern
 * `verify-batch.mjs` and `classical-triage-batch.mjs` use for their own
 * flags. Neither tag ever touches `reviewedBy`/`reviewedAt`: those mean a
 * *human* stands behind the text (schema.ts's own anchor-provenance rule),
 * which an automated pass — however high-confidence — is not.
 *
 * Complements, not replaces, lint.ts's own `language-mismatch` rule: that
 * rule is a cheap, deterministic keyword count run on every entry in CI, and
 * only catches an entry written in the wrong language outright. This script
 * is slower and costs tokens, so it's a deliberate batch pass, not a CI
 * gate — but it catches the subtler case a keyword count structurally
 * cannot: a few stray words from another language mixed into otherwise-
 * correct text, a spelling mistake, or phrasing that just doesn't read as
 * native. Locale-agnostic by design (lib/language-quality.mjs derives the
 * target language from the locale code itself), so it works unchanged for
 * en, nl, or any locale the corpus grows into later.
 *
 * Defaults to `--provider=gemini --model=gemini-3.5-flash-lite`, not
 * whatever provider/model generated the entries, and not whatever
 * GEMINI_MODEL happens to be set to for other scripts: a model judging its
 * own output's fluency is a weak signal (especially for qwen2.5:14b, the
 * model under suspicion that prompted this script), and flash-lite was
 * chosen specifically for this task after a 6-case head-to-head against
 * gemini-3.8-flash and gemini-3.1-pro-preview — same accuracy (6/6: typo
 * fix, Dutch d/t-fout fix, correctly leaving valid-but-unusual style alone,
 * correctly flagging wrong-language and word-salad text as BAD), but zero
 * thinking tokens against their ~900-1500 for the same 6 calls. Override
 * with `--model=` to compare again later, or `--provider=ollama` for a
 * *different* local model (via OLLAMA_MODEL) — not the one that wrote the
 * entries.
 *
 * To act on what this flags as BAD: remove those entries with
 * `remove-by-tag.mjs --tag=language-quality-flagged-by-judge`, then re-run
 * `generate-batch.mjs` for the same locale — removed keys are "genuinely
 * missing" to that script's own gap-filler logic, so it regenerates exactly
 * those, now through the retry-until-correct-language loop generate-batch.mjs
 * already has for this. Same revert-then-regenerate shape as #371's
 * precedent for the Mistral synastry-aspect batch.
 *
 * Writes to the corpus file like `verify-batch.mjs` does, with the same
 * caveat `remove-by-model.mjs` documents for its own writes: don't run this
 * against a locale that a `generate-batch.mjs` process is actively
 * regenerating right now, since that process holds its own in-memory copy of
 * the corpus and will periodically overwrite the file from it, discarding
 * (or in the worst case, conflicting with) whatever this script just wrote.
 *
 *   npx tsx --env-file=.env.local tools/corpus-gen/language-quality-batch.mjs --locale=nl [--provider=gemini|ollama] [--model=<name>] [--limit=N] [--concurrency=N] [--batch]
 *
 * `--batch` (Gemini only, same restriction as generate-batch.mjs's own flag of the same name)
 * submits every candidate's judge request as one inline Gemini Batch API job instead of one HTTP
 * call per entry, at Google's 50%-of-standard-rate batch pricing. Unlike generate-batch.mjs's
 * `--batch`, there is no multi-round retry here — a GOOD/FIXED/BAD verdict is accepted as-is in
 * either mode, there is nothing to re-request. `--concurrency` is ignored under `--batch` for the
 * same reason it is in generate-batch.mjs: one submission, not N parallel callers.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLanguageQualityPrompt, LANGUAGE_QUALITY_RESPONSE_SCHEMA } from './lib/language-quality.mjs';
import { buildBatchRequest, submitBatch, pollBatch, extractBatchResults } from './lib/gemini-batch.mjs';
import { writeCorpus } from './lib/write-corpus.mjs';
import { estimateCostCentsForCall, formatCents } from './lib/cost-estimate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FLAG_TAG = 'language-quality-flagged-by-judge';
const CORRECTED_TAG = 'spelling-corrected-by-judge';

async function withConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runOne() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runOne));
  return results;
}

const rawArgs = process.argv.slice(2);
function flag(name, fallback) {
  const found = rawArgs.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(
    'Usage: npx tsx --env-file=.env.local tools/corpus-gen/language-quality-batch.mjs --locale=nl [--provider=gemini|ollama] [--model=<name>] [--limit=N] [--concurrency=N] [--batch]',
  );
  process.exit(0);
}

// Not restricted to a fixed `en|nl` allowlist like generate-batch.mjs's own locale check — this
// script's rubric (lib/language-quality.mjs) is written to work for any locale from the start,
// so there's nothing locale-specific here to update when a third locale's corpus file arrives.
const locale = flag('locale');
if (!locale) throw new Error('--locale=<locale> is required');
const limit = Number(flag('limit', Infinity));
const concurrency = Number(flag('concurrency', '3'));
const useBatch = rawArgs.includes('--batch');

const provider = flag('provider', 'gemini');
if (provider !== 'gemini' && provider !== 'ollama')
  throw new Error(`--provider must be "gemini" or "ollama", got "${provider}"`);
if (useBatch && provider !== 'gemini') {
  throw new Error("--batch requires --provider=gemini — Gemini's Batch API has no Ollama equivalent");
}
const { generateStructured } = await import(provider === 'ollama' ? './lib/ollama.mjs' : './lib/gemini.mjs');
// Deliberately not process.env.GEMINI_MODEL — see this file's own doc comment on why flash-lite
// is pinned here specifically, independent of whatever other scripts have that env var set to.
const model = provider === 'ollama' ? flag('model', process.env.OLLAMA_MODEL || 'gemma4') : flag('model', 'gemini-3.5-flash-lite');
const baseUrl = provider === 'ollama' ? process.env.OLLAMA_BASE_URL : process.env.GEMINI_BASE_URL;

const corpusPath = join(root, 'src', 'interpretation', 'corpus', `${locale}.json`);
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));

const candidates = corpus
  .map((entry, index) => ({ entry, index }))
  .filter(({ entry }) => !entry.tags.includes(FLAG_TAG) && !entry.tags.includes(CORRECTED_TAG))
  .slice(0, Number.isFinite(limit) ? limit : undefined);

console.log(
  `[${locale}] provider: ${provider} (model: ${String(model)}) — ${String(candidates.length)} entries to check for language quality`,
);
if (candidates.length === 0) {
  console.log(`[${locale}] nothing to do.`);
  process.exit(0);
}

let good = 0;
let fixed = 0;
let flagged = 0;
let failed = 0;
let usageIn = 0;
let usageOut = 0;
const lock = { writing: Promise.resolve() };

async function persist() {
  lock.writing = lock.writing.then(() => writeCorpus(corpusPath, corpus));
  await lock.writing;
}

/** Applies one judge verdict to `corpus[index]`, persists if it changed anything, updates counts. */
async function applyVerdict(entry, index, result) {
  if (result.verdict === 'FIXED') {
    corpus[index] = { ...entry, text: result.correctedText, tags: [...entry.tags, CORRECTED_TAG] };
    await persist();
    fixed += 1;
    console.log(`[${locale}] FIXED ${entry.key}: ${result.issues.join(' / ')}`);
  } else if (result.verdict === 'BAD') {
    corpus[index] = { ...entry, tags: [...entry.tags, FLAG_TAG] };
    await persist();
    flagged += 1;
    console.log(`[${locale}] FLAGGED ${entry.key}: ${result.issues.join(' / ')}`);
  } else {
    good += 1;
  }
}

if (useBatch) {
  const requests = candidates.map(({ entry, index }) => {
    const { systemInstruction, userContent } = buildLanguageQualityPrompt({ entryText: entry.text, locale: entry.locale });
    return buildBatchRequest({
      key: String(index), // corpus array index — unique per entry regardless of persona, unlike entry.key
      systemInstruction,
      userContent,
      temperature: 0,
      responseSchema: LANGUAGE_QUALITY_RESPONSE_SCHEMA,
    });
  });

  console.log(`\n[${locale}] submitting ${String(requests.length)} request${requests.length === 1 ? '' : 's'} as one batch job...`);
  const submitted = await submitBatch({
    apiKey: process.env.GEMINI_API_KEY,
    baseUrl,
    model,
    displayName: `astraya-language-quality-${locale}-${String(Date.now())}`,
    requests,
  });
  console.log(`[${locale}] ${submitted.name} — polling...`);

  let lastState;
  const finished = await pollBatch({
    apiKey: process.env.GEMINI_API_KEY,
    baseUrl,
    name: submitted.name,
    onPoll: (state) => {
      if (state !== lastState) {
        lastState = state;
        console.log(`[${locale}] ${String(state)}`);
      }
    },
  });

  const byKey = new Map(extractBatchResults(finished).map((r) => [r.key, r]));
  for (const { entry, index } of candidates) {
    const result = byKey.get(String(index));
    if (result === undefined) {
      failed += 1;
      console.error(`[${locale}] FAILED ${entry.key}: no result came back for this entry`);
      continue;
    }
    if (result.error) {
      failed += 1;
      console.error(`[${locale}] FAILED ${entry.key}: ${result.error.message}`);
      continue;
    }
    usageIn += result.usage?.promptTokenCount ?? 0;
    usageOut += (result.usage?.candidatesTokenCount ?? 0) + (result.usage?.thoughtsTokenCount ?? 0);
    await applyVerdict(entry, index, result.result);
  }
} else {
  await withConcurrency(candidates, concurrency, async ({ entry, index }) => {
    const { systemInstruction, userContent } = buildLanguageQualityPrompt({ entryText: entry.text, locale: entry.locale });

    try {
      const result = await generateStructured({
        apiKey: process.env.GEMINI_API_KEY,
        model,
        baseUrl,
        temperature: 0,
        systemInstruction,
        userContent,
        responseSchema: LANGUAGE_QUALITY_RESPONSE_SCHEMA,
        maxRetries: 5,
        onUsage: (usage) => {
          usageIn += usage?.promptTokenCount ?? 0;
          usageOut += (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
        },
      });
      await applyVerdict(entry, index, result);
    } catch (error) {
      failed += 1;
      console.error(`[${locale}] FAILED ${entry.key}: ${error.message}`);
    }
  });
}

console.log(
  `\n[${locale}] language-quality check complete: ${String(candidates.length)} checked — ` +
    `${String(good)} good, ${String(fixed)} fixed, ${String(flagged)} flagged, ${String(failed)} failed`,
);
{
  const costCents = estimateCostCentsForCall({
    provider,
    model,
    tier: useBatch ? 'batch' : 'standard',
    promptTokens: usageIn,
    outputTokens: usageOut,
  });
  console.log(
    `[${locale}] usage: ${String(usageIn)} input tokens, ${String(usageOut)} output tokens — ` +
      (costCents === undefined
        ? `cost unknown (no pricing on file for ${model})`
        : `est. cost: ${formatCents(costCents)}`),
  );
}
