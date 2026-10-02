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
 * Tracks per-entry evaluation-loop state in tools/corpus-gen/eval-tracking/<locale>.json
 * (lib/eval-tracking.mjs): an entry judged clean *here* is skipped on every future run —
 * re-checking something this script's own judge already found fine just re-pays for the same
 * judgment. A flagged entry stays eligible for re-checking through improve-corpus-batch.mjs's
 * review (whether that review rewrites it or declines to) until it has gone through
 * `--evaluation-limit` rounds (default 2) without this script ever agreeing it's clean — then
 * it is left alone, flagged or not, so the loop can't run forever on an entry the two models
 * keep disagreeing about. `--force` bypasses this tracking entirely and re-evaluates everything
 * selected by `--locale`/`--persona`/`--limit`, same as before this tracking existed.
 *
 * Submit-and-exit, not submit-and-block: a batch job can legitimately take OpenAI up to 24h, so
 * this script never sits in a poll loop. Every run first checks every job already recorded in
 * tools/corpus-gen/batch-state/evaluate-<locale>.json — a *list*, since more than one batch can
 * be in flight for the same locale at once (e.g. run back to back to parallelize throughput). For
 * each: a still-running job is reported and left on the list; a finished one has its results
 * retrieved and applied (same as before), then drops off the list. Whatever's left genuinely
 * eligible after that — with anything a still-running job already covers subtracted out, so the
 * same entry is never judged by two jobs at once — is submitted as a new batch (unless
 * `--check-only` is passed, which only checks/applies and never submits). Either way the script
 * exits immediately after; there's no need to keep a terminal open or a process alive across the
 * wait. Run it again (same `--locale`) whenever it's convenient to check.
 *
 * `--check-only` without `--locale` widens this to every locale that has a batch-state file at
 * all: it scans tools/corpus-gen/batch-state/evaluate-*.json, reports which locale has which
 * batch running (and still applies any that happen to have finished), without needing to know in
 * advance which locale(s) you're waiting on. `--locale` stays required for every other mode,
 * since submitting a new batch always has to be against one specific corpus.
 *
 * Prints an estimated total cost on completion, from each result's own token usage and
 * lib/cost-estimate.mjs's batch-tier pricing table — an estimate for visibility, not a billing
 * record.
 *
 * Always batch mode (OpenAI only) — there is no per-item synchronous path here the way
 * generate-batch.mjs's --batch is one of two modes, since the whole point of this feature is to
 * run the ChatGPT side cheaply at corpus scale.
 *
 *   npx tsx --env-file=.env.local tools/corpus-gen/evaluate-corpus-batch.mjs --locale=en [--limit=N] [--model=<name>] [--persona=<id>] [--evaluation-limit=N] [--force] [--check-only]
 *   npx tsx --env-file=.env.local tools/corpus-gen/evaluate-corpus-batch.mjs --check-only   (checks every locale with a batch in flight)
 */
import { readFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEvaluationPrompt, EVALUATION_RESPONSE_SCHEMA } from './lib/corpus-evaluation.mjs';
import { buildBatchRequest, submitBatch, getBatch, isBatchTerminal, extractBatchResults } from './lib/openai-batch.mjs';
import { factsDescription } from './lib/placements.mjs';
import { parsePlacementKey } from '../../src/interpretation/schema.ts';
import { readFeedback, writeFeedback, upsertFeedback } from './lib/corpus-feedback.mjs';
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
    'Usage: npx tsx --env-file=.env.local tools/corpus-gen/evaluate-corpus-batch.mjs --locale=en [--limit=N] [--model=<name>] [--persona=<id>] [--evaluation-limit=N] [--force] [--check-only]',
  );
  console.log(
    '       npx tsx --env-file=.env.local tools/corpus-gen/evaluate-corpus-batch.mjs --check-only   (checks every locale with a batch in flight)',
  );
  process.exit(0);
}

const locale = flag('locale');
const limit = Number(flag('limit', Infinity));
const model = flag('model', 'gpt-6-luna');
const personaFilter = flag('persona'); // omit to check every persona, including neutral
const evaluationLimit = Number(flag('evaluation-limit', 2));
const force = rawArgs.includes('--force');
// Checks every job already in flight (applying results for any that finished) and exits — never
// builds a new candidate list or submits anything. Combined with omitting `--locale`, scans every
// locale that has a batch-state file instead of just one.
const checkOnly = rawArgs.includes('--check-only');

if (!locale && !checkOnly) {
  throw new Error(
    '--locale=<locale> is required (unless using --check-only without --locale, which checks every locale)',
  );
}

// This locale's batch-state file holds a *list* of jobs, not just one — a run can have several
// batches in flight at once (e.g. kicked off back to back to parallelize throughput). Every call
// checks all of them (one single-shot status call each, never a blocking poll): a terminal job's
// results are retrieved and applied, then it drops off the list; a still-running one stays on it
// and is reported, not re-submitted.
async function checkAndApply(loc) {
  const corpusPath = join(root, 'src', 'interpretation', 'corpus', `${loc}.json`);
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));

  const trackingPath = join(root, 'tools', 'corpus-gen', 'eval-tracking', `${loc}.json`);
  const tracking = await readTracking(trackingPath);

  const feedbackPath = join(root, 'tools', 'corpus-gen', 'feedback', `${loc}.json`);
  const statePath = join(root, 'tools', 'corpus-gen', 'batch-state', `evaluate-${loc}.json`);
  const existingState = await readBatchState(statePath);
  const jobs = existingState?.jobs ?? [];

  const stillRunning = [];
  let feedback;
  let anyTerminal = false;
  let totalClean = 0;
  let totalFlagged = 0;
  let totalFailed = 0;
  let totalCostCents = 0;
  let costUnknown = false;

  for (const job of jobs) {
    console.log(
      `[${loc}] checking batch ${job.batchId} (submitted ${job.submittedAt}, ${String(job.candidates.length)} entries)...`,
    );
    const batch = await getBatch({ apiKey: process.env.OPENAI_API_KEY, batchId: job.batchId });
    if (!isBatchTerminal(batch)) {
      const counts = batch.request_counts;
      console.log(
        `[${loc}] batch ${job.batchId} still ${batch.status}${counts ? ` (${String(counts.completed)}/${String(counts.total)} done, ${String(counts.failed)} failed)` : ''}`,
      );
      stillRunning.push(job);
      continue;
    }
    console.log(`[${loc}] batch ${job.batchId} is ${batch.status} — retrieving results...`);
    anyTerminal = true;
    if (feedback === undefined) feedback = await readFeedback(feedbackPath);

    // Rebuild this job's own candidates from the identity list captured at submission time,
    // against the corpus as it stands now — same (key, persona) lookup convention as
    // corpus-feedback.mjs/eval-tracking.mjs.
    const byIdentity = new Map(corpus.map((entry) => [identityOf(entry), entry]));
    const candidates = job.candidates.map(({ key, persona }) => {
      const entry = byIdentity.get(identityOf({ key, persona }));
      const placement = entry ? parsePlacementKey(entry.key) : undefined;
      return entry && placement ? { entry, placement } : undefined;
    });

    const results = await extractBatchResults({ apiKey: process.env.OPENAI_API_KEY, batch });
    const byCustomId = new Map(results.map((r) => [r.customId, r]));

    candidates.forEach((candidate, index) => {
      if (candidate === undefined) {
        totalFailed += 1;
        console.error(
          `[${loc}] FAILED ${job.candidates[index].key}: entry no longer resolves against the current corpus`,
        );
        return;
      }
      const { entry } = candidate;
      const result = byCustomId.get(String(index));
      if (result === undefined) {
        totalFailed += 1;
        console.error(`[${loc}] FAILED ${entry.key}: no result came back for this entry`);
        return;
      }
      if (result.error) {
        totalFailed += 1;
        console.error(`[${loc}] FAILED ${entry.key}: ${result.error.message}`);
        return;
      }
      const costCents = estimateBatchCostCents(job.model, result.usage?.prompt_tokens, result.usage?.completion_tokens);
      if (costCents === undefined) costUnknown = true;
      else totalCostCents += costCents;
      const existingTracking = findTracking(tracking, entry);
      const now = new Date().toISOString();
      if (result.result.correct === false) {
        totalFlagged += 1;
        upsertFeedback(feedback, {
          key: entry.key,
          persona: entry.persona,
          locale: entry.locale,
          originalText: entry.text,
          issues: result.result.issues,
          flaggedAt: now,
        });
        upsertTracking(tracking, {
          key: entry.key,
          persona: entry.persona,
          locale: entry.locale,
          clean: false,
          evaluationCount: existingTracking?.evaluationCount ?? 0,
          updatedAt: now,
        });
        console.log(`[${loc}] FLAGGED ${entry.key}: ${result.result.issues.join(' / ')}`);
      } else {
        totalClean += 1;
        upsertTracking(tracking, {
          key: entry.key,
          persona: entry.persona,
          locale: entry.locale,
          clean: true,
          evaluationCount: existingTracking?.evaluationCount ?? 0,
          updatedAt: now,
        });
      }
    });
  }

  if (anyTerminal) {
    await mkdir(dirname(feedbackPath), { recursive: true });
    await writeFeedback(feedbackPath, feedback);
    await mkdir(dirname(trackingPath), { recursive: true });
    await writeTracking(trackingPath, tracking);
    console.log(
      `\n[${loc}] evaluation complete: ${String(totalClean + totalFlagged + totalFailed)} checked — ${String(totalClean)} clean, ${String(totalFlagged)} flagged, ${String(totalFailed)} failed`,
    );
    console.log(
      `[${loc}] estimated cost: ${formatCents(totalCostCents)}${costUnknown ? ` (+ unknown — no batch pricing on file for one or more models)` : ''}`,
    );
    console.log(`[${loc}] feedback written to ${feedbackPath}`);
    console.log(`[${loc}] tracking written to ${trackingPath}`);
  }

  return { corpus, tracking, trackingPath, feedbackPath, statePath, jobs, stillRunning, anyTerminal };
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
    .filter((f) => f.startsWith('evaluate-') && f.endsWith('.json'))
    .map((f) => f.slice('evaluate-'.length, -'.json'.length))
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

const { corpus, tracking, statePath, jobs, stillRunning, anyTerminal } = await checkAndApply(locale);

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

const inFlightIdentities = new Set(stillRunning.flatMap((job) => job.candidates.map(identityOf)));

const selected = corpus
  .filter((entry) => personaFilter === undefined || (entry.persona ?? 'neutral') === personaFilter)
  .filter((entry) => !inFlightIdentities.has(identityOf(entry)))
  .map((entry) => {
    const placement = parsePlacementKey(entry.key);
    return placement === undefined ? undefined : { entry, placement };
  })
  .filter((item) => item !== undefined);

const eligible = force
  ? selected
  : selected.filter((item) => !isEvaluationExhausted(findTracking(tracking, item.entry), evaluationLimit));
const alreadyResolved = selected.length - eligible.length;
const candidates = eligible.slice(0, Number.isFinite(limit) ? limit : undefined);

console.log(
  `[${locale}] model: ${model} — ${String(candidates.length)} entries to evaluate${personaFilter ? ` (persona=${personaFilter})` : ''}${alreadyResolved > 0 ? ` (${String(alreadyResolved)} already resolved, skipped)` : ''}${inFlightIdentities.size > 0 ? ` (${String(inFlightIdentities.size)} already covered by ${String(stillRunning.length)} running batch(es))` : ''}`,
);
if (candidates.length === 0) {
  if (stillRunning.length > 0) await writeBatchState(statePath, { jobs: stillRunning });
  else await clearBatchState(statePath);
  if (stillRunning.length === 0 && !anyTerminal) console.log(`[${locale}] nothing to do.`);
  process.exit(0);
}

const requests = candidates.map(({ entry, placement }, index) => {
  // If Gemini rejected a complaint about this exact entry last round (improve-corpus-batch.mjs's
  // UNCHANGED verdict), hand that rejection back to this judge now — reviewing with the other
  // side's reasoning already in view, not re-flagging the same thing blind every round (#381).
  const priorRejection = findTracking(tracking, entry)?.lastRejection;
  const { systemInstruction, userContent } = buildEvaluationPrompt({
    factsDescription: factsDescription(placement),
    entryText: entry.text,
    ...(priorRejection ? { priorRejection } : {}),
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
const newJob = {
  batchId: submitted.id,
  submittedAt: new Date().toISOString(),
  model,
  candidates: candidates.map(({ entry }) => ({ key: entry.key, persona: entry.persona })),
};
await writeBatchState(statePath, { jobs: [...stillRunning, newJob] });
console.log(
  `[${locale}] submitted batch ${submitted.id} covering ${String(candidates.length)} entries${stillRunning.length > 0 ? ` (${String(stillRunning.length)} other batch(es) still running for this locale)` : ''} — OpenAI batches can take up to 24h; run this script again later (same --locale) to check status and apply results once it's done.`,
);
