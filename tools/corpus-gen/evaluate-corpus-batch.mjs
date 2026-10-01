/**
 * #381 stage 1 of 2: an independent second opinion on the Gemini-generated corpus, via OpenAI's
 * Batch API, judged against both fact-grounding and the "generic trope / stereotyped shadow"
 * failure mode #379/#380's own generator prompt work exists to prevent — see
 * lib/corpus-evaluation.mjs's own doc comment for the full rubric and the real 4-model accuracy
 * comparison that picked gpt-6-luna as this script's default.
 *
 * Writes every entry the judge flags (not every entry checked — only the ones with a real
 * concern) to tools/corpus-gen/feedback/<locale>.json, one record per flagged entry: its key,
 * persona, original text, and the judge's own specific issues. Never touches the corpus itself
 * — this script is read-only against src/interpretation/corpus/<locale>.json; see
 * improve-corpus-batch.mjs for the half that acts on this file.
 *
 * Always batch mode (OpenAI only) — there is no per-item synchronous path here the way
 * generate-batch.mjs's --batch is one of two modes, since the whole point of this feature is to
 * run the ChatGPT side cheaply at corpus scale.
 *
 *   npx tsx --env-file=.env.local tools/corpus-gen/evaluate-corpus-batch.mjs --locale=en [--limit=N] [--model=<name>] [--persona=<id>]
 */
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvaluationPrompt, EVALUATION_RESPONSE_SCHEMA } from './lib/corpus-evaluation.mjs';
import { buildBatchRequest, submitBatch, pollBatch, extractBatchResults } from './lib/openai-batch.mjs';
import { factsDescription } from './lib/placements.mjs';
import { parsePlacementKey } from '../../src/interpretation/schema.ts';
import { readFeedback, writeFeedback, upsertFeedback } from './lib/corpus-feedback.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const rawArgs = process.argv.slice(2);
function flag(name, fallback) {
  const found = rawArgs.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(
    'Usage: npx tsx --env-file=.env.local tools/corpus-gen/evaluate-corpus-batch.mjs --locale=en [--limit=N] [--model=<name>] [--persona=<id>]',
  );
  process.exit(0);
}

const locale = flag('locale');
if (!locale) throw new Error('--locale=<locale> is required');
const limit = Number(flag('limit', Infinity));
const model = flag('model', 'gpt-6-luna');
const personaFilter = flag('persona'); // omit to check every persona, including neutral

const corpusPath = join(root, 'src', 'interpretation', 'corpus', `${locale}.json`);
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));

const candidates = corpus
  .filter((entry) => personaFilter === undefined || (entry.persona ?? 'neutral') === personaFilter)
  .map((entry) => {
    const placement = parsePlacementKey(entry.key);
    return placement === undefined ? undefined : { entry, placement };
  })
  .filter((item) => item !== undefined)
  .slice(0, Number.isFinite(limit) ? limit : undefined);

console.log(
  `[${locale}] model: ${model} — ${String(candidates.length)} entries to evaluate${personaFilter ? ` (persona=${personaFilter})` : ''}`,
);
if (candidates.length === 0) {
  console.log(`[${locale}] nothing to do.`);
  process.exit(0);
}

const requests = candidates.map(({ entry, placement }, index) => {
  const { systemInstruction, userContent } = buildEvaluationPrompt({
    factsDescription: factsDescription(placement),
    entryText: entry.text,
  });
  return buildBatchRequest({
    customId: String(index), // position in `candidates` — unique regardless of persona, unlike entry.key alone
    model,
    systemInstruction,
    userContent,
    // No temperature override: gpt-6-luna (this script's own default) rejects anything but its
    // own default (1) — see openai-batch.mjs's buildBatchRequest doc comment, found via a real
    // batch job's error file, not guessed.
    responseSchema: EVALUATION_RESPONSE_SCHEMA,
    schemaName: 'evaluation',
  });
});

console.log(
  `\n[${locale}] submitting ${String(requests.length)} request${requests.length === 1 ? '' : 's'} as one batch job...`,
);
const submitted = await submitBatch({ apiKey: process.env.OPENAI_API_KEY, requests });
console.log(`[${locale}] batch ${submitted.id} — polling...`);

let lastStatus;
const finished = await pollBatch({
  apiKey: process.env.OPENAI_API_KEY,
  batchId: submitted.id,
  onPoll: (status, counts) => {
    if (status !== lastStatus) {
      lastStatus = status;
      console.log(
        `[${locale}] ${status}${counts ? ` (${String(counts.completed)}/${String(counts.total)} done, ${String(counts.failed)} failed)` : ''}`,
      );
    }
  },
});

const results = await extractBatchResults({ apiKey: process.env.OPENAI_API_KEY, batch: finished });
const byCustomId = new Map(results.map((r) => [r.customId, r]));

const feedbackPath = join(root, 'tools', 'corpus-gen', 'feedback', `${locale}.json`);
const feedback = await readFeedback(feedbackPath);

let flagged = 0;
let clean = 0;
let failed = 0;
candidates.forEach(({ entry }, index) => {
  const result = byCustomId.get(String(index));
  if (result === undefined) {
    failed += 1;
    console.error(`[${locale}] FAILED ${entry.key}: no result came back for this entry`);
    return;
  }
  if (result.error) {
    failed += 1;
    console.error(`[${locale}] FAILED ${entry.key}: ${result.error.message}`);
    return;
  }
  if (result.result.correct === false) {
    flagged += 1;
    upsertFeedback(feedback, {
      key: entry.key,
      persona: entry.persona,
      locale: entry.locale,
      originalText: entry.text,
      issues: result.result.issues,
      flaggedAt: new Date().toISOString(),
    });
    console.log(`[${locale}] FLAGGED ${entry.key}: ${result.result.issues.join(' / ')}`);
  } else {
    clean += 1;
  }
});

await mkdir(dirname(feedbackPath), { recursive: true });
await writeFeedback(feedbackPath, feedback);

console.log(
  `\n[${locale}] evaluation complete: ${String(candidates.length)} checked — ${String(clean)} clean, ${String(flagged)} flagged, ${String(failed)} failed`,
);
console.log(`[${locale}] feedback written to ${feedbackPath}`);
