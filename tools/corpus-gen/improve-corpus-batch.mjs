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
 * Also updates tools/corpus-gen/eval-tracking/<locale>.json (lib/eval-tracking.mjs), the state
 * evaluate-corpus-batch.mjs reads to decide what still needs checking: every verdict here —
 * IMPROVED or UNCHANGED — consumes one feedback-loop iteration (`evaluationCount += 1`). An
 * UNCHANGED verdict is Gemini declining ChatGPT's complaint, not confirming the entry clean, so
 * it does *not* mark the entry clean — the two models disagreeing is exactly the "not clean"
 * outcome #63's acceptance criteria expects a small residual percentage of once the loop
 * exhausts (`--evaluation-limit`, default 2), not something resolved on the first disagreement.
 * `clean` is only ever set by evaluate-corpus-batch.mjs's own judge actually agreeing an entry is
 * correct, never by this script declining a rewrite.
 *
 * Prints an estimated total cost on completion, from each result's own token usage
 * (`usageMetadata`, including `thoughtsTokenCount` — Gemini bills thinking tokens as output,
 * confirmed against a real response) and lib/cost-estimate.mjs's batch-tier pricing table — an
 * estimate for visibility, not a billing record.
 *
 * Always batch mode (Gemini), reusing lib/gemini-batch.mjs — the same client
 * generate-batch.mjs's own --batch and language-quality-batch.mjs's --batch already use.
 *
 * Submit-and-exit, not submit-and-block: a batch job can legitimately take Gemini up to its own
 * 48-hour hard expiry, so this script never sits in a poll loop. Every run first checks every job
 * already recorded in tools/corpus-gen/batch-state/improve-<locale>.json — a *list*, since more
 * than one batch can be in flight for the same locale at once. For each: a still-running job is
 * reported and left on the list; a finished one has its results retrieved and applied (same as
 * before), then drops off the list. Whatever's left genuinely eligible in the feedback file after
 * that — with anything a still-running job already covers subtracted out, so the same flagged
 * entry is never reviewed by two jobs at once — is submitted as a new batch (unless
 * `--check-only` is passed, which only checks/applies and never submits). Run the script again
 * (same `--locale`) whenever it's convenient to check.
 *
 * `--check-only` without `--locale` widens this to every locale that has a batch-state file at
 * all: it scans tools/corpus-gen/batch-state/improve-*.json, reports which locale has which
 * batch running (and still applies any that happen to have finished), without needing to know in
 * advance which locale(s) you're waiting on. `--locale` stays required for every other mode,
 * since submitting a new batch always has to be against one specific locale's feedback/corpus.
 *
 *   npx tsx --env-file=.env.local tools/corpus-gen/improve-corpus-batch.mjs --locale=en [--limit=N] [--model=<name>] [--check-only]
 *   npx tsx --env-file=.env.local tools/corpus-gen/improve-corpus-batch.mjs --check-only   (checks every locale with a batch in flight)
 */
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemInstruction } from './lib/prompt.mjs';
import { buildImprovementPrompt, IMPROVEMENT_RESPONSE_SCHEMA } from './lib/corpus-improvement.mjs';
import { buildBatchRequest, submitBatch, getBatch, isBatchTerminal, extractBatchResults } from './lib/gemini-batch.mjs';
import { buildSymbolismContext, symbolismScopeFor, factsDescription } from './lib/placements.mjs';
import { parsePlacementKey } from '../../src/interpretation/schema.ts';
import { lintEntry } from '../../src/interpretation/lint.ts';
import { containsPromptInjectionPhrase } from '../../src/interpretation/prompt-guardrail.ts';
import { writeCorpus } from './lib/write-corpus.mjs';
import { readFeedback, writeFeedback, removeFeedback } from './lib/corpus-feedback.mjs';
import {
  readTracking,
  writeTracking,
  findTracking,
  upsertTracking,
  isEvaluationExhausted,
} from './lib/eval-tracking.mjs';
import { estimateBatchCostCents, formatCents } from './lib/cost-estimate.mjs';
import { readBatchState, writeBatchState, clearBatchState } from './lib/batch-state.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const IMPROVED_TAG = 'improved-via-feedback-loop';

function identityOf(item) {
  return `${item.key}\u0000${item.persona ?? 'neutral'}`;
}

const rawArgs = process.argv.slice(2);
function flag(name, fallback) {
  const found = rawArgs.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(
    'Usage: npx tsx --env-file=.env.local tools/corpus-gen/improve-corpus-batch.mjs --locale=en [--limit=N] [--model=<name>] [--evaluation-limit=N] [--last-resort] [--check-only]',
  );
  console.log(
    '       npx tsx --env-file=.env.local tools/corpus-gen/improve-corpus-batch.mjs --check-only   (checks every locale with a batch in flight)',
  );
  process.exit(0);
}

const locale = flag('locale');
const limit = Number(flag('limit', Infinity));
const model = flag('model', process.env.GEMINI_MODEL);
const baseUrl = process.env.GEMINI_BASE_URL;
const evaluationLimit = Number(flag('evaluation-limit', 2));
// #396's quintile/biquintile stragglers: entries already exhausted (evaluationCount >= limit)
// without agreement never get a fresh feedback-file record, since evaluate-corpus-batch.mjs's own
// exhaustion filter excludes them from being re-flagged — so the normal feedback-driven path below
// can never reach them. `--last-resort` sources records straight from tracking instead (every
// `!clean`, exhausted, not-yet-attempted entry with a recorded `lastRejection`), and passes
// `lastResort: true` into the prompt (lib/corpus-improvement.mjs) permitting one minimal,
// non-technical nod to the aspect's nature as a genuine last resort. Each entry is only ever given
// one such attempt — `lastResortAttempted: true` is recorded regardless of verdict so a later
// `--last-resort` run never re-offers it.
const lastResort = rawArgs.includes('--last-resort');
// Checks every job already in flight (applying results for any that finished) and exits — never
// builds a new request list or submits anything. Combined with omitting `--locale`, scans every
// locale that has a batch-state file instead of just one.
const checkOnly = rawArgs.includes('--check-only');

if (!locale && !checkOnly) {
  throw new Error(
    '--locale=<locale> is required (unless using --check-only without --locale, which checks every locale)',
  );
}

const personas = JSON.parse(await readFile(join(root, 'tools', 'corpus-gen', 'personas.json'), 'utf8')).personas;

// This locale's batch-state file holds a *list* of jobs, not just one — more than one batch can
// be in flight for the same locale at once. Every call checks all of them (one single-shot status
// call each, never a blocking poll): a terminal job's results are retrieved and applied, then it
// drops off the list; a still-running one stays on it and is reported, not re-submitted.
async function checkAndApply(loc) {
  const feedbackPath = join(root, 'tools', 'corpus-gen', 'feedback', `${loc}.json`);
  const feedback = await readFeedback(feedbackPath);

  const corpusPath = join(root, 'src', 'interpretation', 'corpus', `${loc}.json`);
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));

  const trackingPath = join(root, 'tools', 'corpus-gen', 'eval-tracking', `${loc}.json`);
  const tracking = await readTracking(trackingPath);

  const statePath = join(root, 'tools', 'corpus-gen', 'batch-state', `improve-${loc}.json`);
  const existingState = await readBatchState(statePath);
  const jobs = existingState?.jobs ?? [];

  const stillRunning = [];
  let anyTerminal = false;
  let improved = 0;
  let unchanged = 0;
  let failed = 0;
  let skipped = 0;
  let totalCostCents = 0;
  let costUnknown = false;

  for (const job of jobs) {
    console.log(
      `[${loc}] checking batch ${job.name} (submitted ${job.submittedAt}, ${String(job.records.length)} entries)...`,
    );
    const operation = await getBatch({ apiKey: process.env.GEMINI_API_KEY, baseUrl, name: job.name });
    if (!isBatchTerminal(operation)) {
      console.log(`[${loc}] batch ${job.name} still ${String(operation.metadata?.state)}`);
      stillRunning.push(job);
      continue;
    }
    console.log(`[${loc}] batch ${job.name} is ${String(operation.metadata?.state)} — retrieving results...`);
    anyTerminal = true;

    const indexByIdentity = new Map(corpus.map((entry, i) => [identityOf(entry), i]));
    const byFeedbackIdentity = new Map(feedback.map((record) => [identityOf(record), record]));
    const results = extractBatchResults(operation);
    const byKey = new Map(results.map((r) => [r.key, r]));

    for (const jobRecord of job.records) {
      const { key, persona } = jobRecord;
      // `--last-resort` jobs (#396) carry their own `issues`/`originalText` straight from
      // tracking at submission time (see below) — there's no feedback-file entry to look up,
      // since these entries are already past evaluate-corpus-batch.mjs's own exhaustion filter
      // and so were never re-flagged into the feedback file this round.
      const record = job.lastResort ? jobRecord : byFeedbackIdentity.get(identityOf({ key, persona }));
      if (record === undefined) {
        skipped += 1;
        console.error(`[${loc}] SKIPPED ${key}: no longer present in the feedback file`);
        continue;
      }
      const corpusIndex = indexByIdentity.get(identityOf(record));
      const result = byKey.get(identityOf(record));
      if (corpusIndex === undefined || result === undefined || result.error) {
        failed += 1;
        console.error(
          `[${loc}] FAILED ${key}: ${result?.error?.message ?? 'no result/corpus entry resolved for this key'}`,
        );
        continue;
      }
      const { verdict, reasoning, text } = result.result;
      console.log(`[${loc}] ${verdict} ${key}: ${reasoning}`);
      // Gemini bills thinking tokens as output, confirmed against a real response's own usageMetadata
      // (totalTokenCount = promptTokenCount + candidatesTokenCount + thoughtsTokenCount).
      const outputTokens = (result.usage?.candidatesTokenCount ?? 0) + (result.usage?.thoughtsTokenCount ?? 0);
      const costCents = estimateBatchCostCents(job.model, result.usage?.promptTokenCount, outputTokens);
      if (costCents === undefined) costUnknown = true;
      else totalCostCents += costCents;
      const existingTracking = findTracking(tracking, record);
      const now = new Date().toISOString();
      if (verdict === 'IMPROVED') {
        const entry = corpus[corpusIndex];
        // Gemini's own revision is never applied blind — lintEntry re-checks the rewrite the same
        // way generate-batch.mjs checks a freshly generated entry, catching e.g. a language flip
        // (the reviewer's own `issues` are always English per corpus-evaluation.mjs, even for a nl
        // entry — confirmed empirically that Gemini's rewrite still stays on-locale, but this is
        // the backstop if a future case ever doesn't) before it ever reaches the shipped corpus.
        const lintIssues = lintEntry({ ...entry, text });
        if (lintIssues.length > 0) {
          failed += 1;
          console.error(
            `[${loc}] REJECTED rewrite for ${key} (lint failed, keeping prior text): ${lintIssues.map((i) => `[${i.rule}] ${i.message}`).join(' / ')}`,
          );
        } else {
          improved += 1;
          // An entry can be rewritten more than once across evaluation-loop rounds (#381's
          // --evaluation-limit) — `includes` guards against the tag piling up a duplicate per round.
          const tags = entry.tags.includes(IMPROVED_TAG) ? entry.tags : [...entry.tags, IMPROVED_TAG];
          corpus[corpusIndex] = { ...entry, text, tags };
        }
      } else {
        unchanged += 1;
      }
      // Either verdict consumes one feedback-loop iteration: an UNCHANGED verdict is Gemini
      // declining ChatGPT's complaint, not confirming the entry clean — the two models disagreeing
      // is exactly the "not clean" case #63's acceptance criteria expects a small residual
      // percentage of after the loop exhausts, not something to wave through as resolved on the
      // first disagreement. `clean` is only ever set by evaluate-corpus-batch.mjs's own judge
      // actually agreeing the entry is correct — never by a rewrite being declined here.
      //
      // A genuine UNCHANGED (Gemini actively disagreeing with the complaint, not a rewrite we
      // ourselves threw out for failing lint) is remembered as `lastRejection` — ChatGPT sees its
      // own rejected issues plus Gemini's reasoning on this entry's next evaluation, rather than
      // the two models re-litigating blind every round. Cleared on any outcome that isn't that
      // exact case: once the text actually changes (IMPROVED), the rejection no longer describes
      // current text.
      upsertTracking(tracking, {
        key: record.key,
        persona: record.persona,
        locale: loc,
        clean: false,
        evaluationCount: (existingTracking?.evaluationCount ?? 0) + 1,
        updatedAt: now,
        ...(verdict === 'UNCHANGED' ? { lastRejection: { issues: record.issues, reasoning } } : {}),
        // A last-resort attempt is spent regardless of verdict — this is a one-time escape valve
        // per entry, never repeatedly offered on later rounds (see the `--last-resort` doc comment
        // above `rawArgs.includes('--last-resort')`). `upsertTracking` *replaces* the whole record
        // rather than merging, so a later ordinary (non-last-resort) round touching this same
        // entry must still carry the flag forward explicitly or it silently reverts to never
        // having been attempted — confirmed as a real bug (not hypothetical): an entry's
        // `lastResortAttempted` was found wiped by exactly this after a follow-up ordinary round.
        ...(job.lastResort || existingTracking?.lastResortAttempted === true ? { lastResortAttempted: true } : {}),
      });
      if (!job.lastResort) removeFeedback(feedback, record);
    }
  }

  if (anyTerminal) {
    await writeCorpus(corpusPath, corpus);
    await writeFeedback(feedbackPath, feedback);
    await mkdir(dirname(trackingPath), { recursive: true });
    await writeTracking(trackingPath, tracking);
    console.log(
      `\n[${loc}] improvement pass complete: ${String(improved + unchanged + failed)} reviewed — ` +
        `${String(improved)} improved, ${String(unchanged)} left unchanged, ${String(failed)} failed, ${String(skipped)} skipped`,
    );
    console.log(
      `[${loc}] estimated cost: ${formatCents(totalCostCents)}${costUnknown ? ` (+ unknown — no batch pricing on file for one or more models)` : ''}`,
    );
    console.log(
      `[${loc}] ${String(feedback.length)} record${feedback.length === 1 ? '' : 's'} remaining in ${feedbackPath}`,
    );
    console.log(`[${loc}] tracking written to ${trackingPath}`);
  }

  return { feedback, corpus, tracking, statePath, jobs, stillRunning, anyTerminal };
}

if (checkOnly && !locale) {
  const stateDir = join(root, 'tools', 'corpus-gen', 'batch-state');
  let files = [];
  try {
    files = await readdir(stateDir);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const locales = files
    .filter((f) => f.startsWith('improve-') && f.endsWith('.json'))
    .map((f) => f.slice('improve-'.length, -'.json'.length))
    .sort();
  if (locales.length === 0) {
    console.log('no batches in flight for any locale.');
    process.exit(0);
  }
  for (const loc of locales) {
    const { jobs, stillRunning, statePath } = await checkAndApply(loc);
    if (jobs.length === 0) console.log(`[${loc}] no batches in flight.`);
    else if (stillRunning.length > 0)
      console.log(`[${loc}] ${String(stillRunning.length)}/${String(jobs.length)} batch(es) still running.`);
    else console.log(`[${loc}] all recorded batches completed and applied.`);
    if (stillRunning.length > 0) await writeBatchState(statePath, { jobs: stillRunning });
    else await clearBatchState(statePath);
  }
  process.exit(0);
}

const { feedback, corpus, tracking, statePath, jobs, stillRunning, anyTerminal } = await checkAndApply(locale);

if (checkOnly) {
  if (jobs.length === 0) console.log(`[${locale}] no batches in flight.`);
  else if (stillRunning.length > 0)
    console.log(
      `[${locale}] ${String(stillRunning.length)} batch(es) still running, ${String(jobs.length - stillRunning.length)} completed and applied — --check-only, not submitting anything new.`,
    );
  else
    console.log(`[${locale}] all recorded batches completed and applied — --check-only, not submitting anything new.`);
  if (stillRunning.length > 0) await writeBatchState(statePath, { jobs: stillRunning });
  else await clearBatchState(statePath);
  process.exit(0);
}

const inFlightIdentities = new Set(stillRunning.flatMap((job) => job.records.map(identityOf)));

let records;
if (lastResort) {
  const corpusByIdentity = new Map(corpus.map((entry) => [identityOf(entry), entry]));
  const eligibleTracking = tracking.filter(
    (t) =>
      !t.clean &&
      isEvaluationExhausted(t, evaluationLimit) &&
      t.lastRejection !== undefined &&
      !t.lastResortAttempted &&
      !inFlightIdentities.has(identityOf(t)),
  );
  records = eligibleTracking
    .map((t) => {
      const entry = corpusByIdentity.get(identityOf(t));
      if (entry === undefined) return undefined;
      return { key: t.key, persona: t.persona, issues: t.lastRejection.issues, originalText: entry.text };
    })
    .filter((r) => r !== undefined)
    .slice(0, Number.isFinite(limit) ? limit : undefined);
} else {
  const eligibleRecords = feedback.filter((record) => !inFlightIdentities.has(identityOf(record)));
  records = eligibleRecords.slice(0, Number.isFinite(limit) ? limit : undefined);
}

if (records.length === 0) {
  if (stillRunning.length > 0) await writeBatchState(statePath, { jobs: stillRunning });
  else await clearBatchState(statePath);
  if (stillRunning.length === 0 && !anyTerminal) console.log(`[${locale}] no feedback to act on — nothing to do.`);
  else if (inFlightIdentities.size > 0)
    console.log(
      `[${locale}] nothing new to submit — remaining feedback is already covered by ${String(stillRunning.length)} running batch(es).`,
    );
  process.exit(0);
}

console.log(
  `[${locale}] model: ${String(model)} — ${String(records.length)} flagged entries to review${inFlightIdentities.size > 0 ? ` (${String(inFlightIdentities.size)} already covered by ${String(stillRunning.length)} running batch(es))` : ''}`,
);

const indexByIdentity = new Map(corpus.map((entry, i) => [identityOf(entry), i]));
const requests = [];
const newlySkipped = [];
for (const record of records) {
  const placement = parsePlacementKey(record.key);
  const corpusIndex = indexByIdentity.get(identityOf(record));
  if (placement === undefined || corpusIndex === undefined) {
    newlySkipped.push(record);
    console.error(`[${locale}] SKIPPED ${record.key}: could not resolve this key back into a corpus entry`);
    continue;
  }
  // #394: `record.issues` is an independent judge model's own free-text output (OpenAI,
  // schema-constrained to "array of string" but not content-validated), about to be embedded
  // into a prompt sent to a *different* model (Gemini) under a plain "REVIEWER'S CONCERNS:"
  // label — the one corpus-gen prompt-building site that hops an unguarded string from one
  // model's output into another model's input. Screened the same way customPrompt is
  // (prompt-guardrail.ts) rather than embedded blind; fails closed (skip, don't strip-and-send)
  // since this is a defense-in-depth measure for a currently-low-exposure pipeline, not a
  // judgment call about what's salvageable in the string.
  const injectedIssue = record.issues.find((issue) => containsPromptInjectionPhrase(issue));
  if (injectedIssue !== undefined) {
    newlySkipped.push(record);
    console.error(
      `[${locale}] SKIPPED ${record.key}: judge-reported issue looks like a prompt-injection attempt, refusing to forward it: "${injectedIssue}"`,
    );
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
    lastResort,
  });
  requests.push(
    buildBatchRequest({
      key: identityOf(record), // (key, persona) composite — distinguishes a neutral and a persona-specific record for the same placement, unlike record.key alone
      systemInstruction,
      userContent,
      temperature: Number(process.env.GEMINI_TEMPERATURE ?? '0.75'),
      responseSchema: IMPROVEMENT_RESPONSE_SCHEMA,
    }),
  );
}

if (requests.length === 0) {
  console.log(`[${locale}] nothing resolvable to submit.`);
  if (stillRunning.length > 0) await writeBatchState(statePath, { jobs: stillRunning });
  else await clearBatchState(statePath);
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
  requests,
});
const newJob = {
  name: submitted.name,
  submittedAt: new Date().toISOString(),
  model,
  // `--last-resort` jobs carry `issues`/`originalText` here too (not just `key`/`persona`), since
  // there's no feedback-file entry for checkAndApply to resolve them against later.
  records: records
    .filter((r) => !newlySkipped.includes(r))
    .map((r) => (lastResort ? r : { key: r.key, persona: r.persona })),
  ...(lastResort ? { lastResort: true } : {}),
};
await writeBatchState(statePath, { jobs: [...stillRunning, newJob] });
console.log(
  `[${locale}] submitted batch ${submitted.name} covering ${String(newJob.records.length)} entries${stillRunning.length > 0 ? ` (${String(stillRunning.length)} other batch(es) still running for this locale)` : ''} — Gemini batches can take up to 48h; run this script again later (same --locale) to check status and apply results once it's done.`,
);
