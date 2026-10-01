/**
 * #381 stage 2 of 2: reads a locale's feedback file (evaluate-corpus-batch.mjs's own output —
 * ChatGPT's second opinion on flagged entries) and asks Gemini, the model that originally wrote
 * each entry, to critically review that feedback and revise only what it agrees is a genuine
 * problem — not apply it unconditionally. See lib/corpus-improvement.mjs's own doc comment for
 * why: a second opinion can itself be wrong, so the model that already knows this placement's
 * facts and this corpus's own house style is the one in a position to judge what's actually
 * worth acting on.
 *
 * An IMPROVED verdict replaces the entry's `text` in place and tags it
 * `improved-via-feedback-loop`, same non-destructive-tag convention
 * language-quality-batch.mjs's own FIXED verdict uses — provenance.model/generatedAt are left
 * alone (they record who originally wrote the text; this revises it, it doesn't re-attribute
 * it). An UNCHANGED verdict touches nothing. Either way the record is removed from the feedback
 * file once processed — reasoning is printed to the console as it happens, which is the audit
 * trail for a run; nothing is held onto needing a second pass once a record has been decided.
 *
 * Always batch mode (Gemini), reusing lib/gemini-batch.mjs — the same client
 * generate-batch.mjs's own --batch and language-quality-batch.mjs's --batch already use.
 *
 *   npx tsx --env-file=.env.local tools/corpus-gen/improve-corpus-batch.mjs --locale=en [--limit=N] [--model=<name>]
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemInstruction } from './lib/prompt.mjs';
import { buildImprovementPrompt, IMPROVEMENT_RESPONSE_SCHEMA } from './lib/corpus-improvement.mjs';
import { buildBatchRequest, submitBatch, pollBatch, extractBatchResults } from './lib/gemini-batch.mjs';
import { buildSymbolismContext, symbolismScopeFor, factsDescription } from './lib/placements.mjs';
import { parsePlacementKey } from '../../src/interpretation/schema.ts';
import { writeCorpus } from './lib/write-corpus.mjs';
import { readFeedback, writeFeedback, removeFeedback } from './lib/corpus-feedback.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const IMPROVED_TAG = 'improved-via-feedback-loop';

const rawArgs = process.argv.slice(2);
function flag(name, fallback) {
  const found = rawArgs.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(
    'Usage: npx tsx --env-file=.env.local tools/corpus-gen/improve-corpus-batch.mjs --locale=en [--limit=N] [--model=<name>]',
  );
  process.exit(0);
}

const locale = flag('locale');
if (!locale) throw new Error('--locale=<locale> is required');
const limit = Number(flag('limit', Infinity));
const model = flag('model', process.env.GEMINI_MODEL);
const baseUrl = process.env.GEMINI_BASE_URL;

const feedbackPath = join(root, 'tools', 'corpus-gen', 'feedback', `${locale}.json`);
const feedback = await readFeedback(feedbackPath);
if (feedback.length === 0) {
  console.log(`[${locale}] no feedback to act on — nothing to do.`);
  process.exit(0);
}

const corpusPath = join(root, 'src', 'interpretation', 'corpus', `${locale}.json`);
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
const indexByIdentity = new Map(corpus.map((entry, i) => [`${entry.key}\u0000${entry.persona ?? 'neutral'}`, i]));

const personas = JSON.parse(await readFile(join(root, 'tools', 'corpus-gen', 'personas.json'), 'utf8')).personas;

const records = feedback.slice(0, Number.isFinite(limit) ? limit : undefined);
console.log(`[${locale}] model: ${String(model)} — ${String(records.length)} flagged entries to review`);

const requests = [];
const skipped = [];
for (const record of records) {
  const placement = parsePlacementKey(record.key);
  const corpusIndex = indexByIdentity.get(`${record.key}\u0000${record.persona ?? 'neutral'}`);
  if (placement === undefined || corpusIndex === undefined) {
    skipped.push(record);
    console.error(`[${locale}] SKIPPED ${record.key}: could not resolve this key back into a corpus entry`);
    continue;
  }
  const persona = record.persona ? personas.find((p) => p.id === record.persona) : undefined;
  const baseSystemInstruction = buildSystemInstruction({
    persona,
    symbolismContext: buildSymbolismContext(locale, symbolismScopeFor(placement)),
    locale,
    forceLanguageDirective: false,
  });
  const { systemInstruction, userContent } = buildImprovementPrompt({
    baseSystemInstruction,
    factsDescription: factsDescription(placement),
    originalText: record.originalText,
    issues: record.issues,
  });
  requests.push({
    record,
    corpusIndex,
    request: buildBatchRequest({
      key: record.key,
      systemInstruction,
      userContent,
      temperature: Number(process.env.GEMINI_TEMPERATURE ?? '0.75'),
      responseSchema: IMPROVEMENT_RESPONSE_SCHEMA,
    }),
  });
}

if (requests.length === 0) {
  console.log(`[${locale}] nothing resolvable to submit.`);
  process.exit(0);
}

console.log(
  `\n[${locale}] submitting ${String(requests.length)} request${requests.length === 1 ? '' : 's'} as one batch job...`,
);
const submitted = await submitBatch({
  apiKey: process.env.GEMINI_API_KEY,
  baseUrl,
  model,
  displayName: `astraya-corpus-improve-${locale}-${String(Date.now())}`,
  requests: requests.map((r) => r.request),
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

const results = extractBatchResults(finished);
const byKey = new Map(results.map((r) => [r.key, r]));

let improved = 0;
let unchanged = 0;
let failed = 0;
for (const { record, corpusIndex } of requests) {
  const result = byKey.get(record.key);
  if (result === undefined || result.error) {
    failed += 1;
    console.error(`[${locale}] FAILED ${record.key}: ${result?.error?.message ?? 'no result came back for this key'}`);
    continue;
  }
  const { verdict, reasoning, text } = result.result;
  console.log(`[${locale}] ${verdict} ${record.key}: ${reasoning}`);
  if (verdict === 'IMPROVED') {
    improved += 1;
    const entry = corpus[corpusIndex];
    corpus[corpusIndex] = { ...entry, text, tags: [...entry.tags, IMPROVED_TAG] };
  } else {
    unchanged += 1;
  }
  removeFeedback(feedback, record);
}

await writeCorpus(corpusPath, corpus);
await writeFeedback(feedbackPath, feedback);

console.log(
  `\n[${locale}] improvement pass complete: ${String(requests.length)} reviewed — ` +
    `${String(improved)} improved, ${String(unchanged)} left unchanged, ${String(failed)} failed, ${String(skipped.length)} skipped`,
);
console.log(
  `[${locale}] ${String(feedback.length)} record${feedback.length === 1 ? '' : 's'} remaining in ${feedbackPath}`,
);
