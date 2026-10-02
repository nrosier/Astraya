/**
 * Quick per-locale snapshot of #381's feedback-loop state: how much of the corpus has been
 * checked by evaluate-corpus-batch.mjs's judge, how much is validated, stuck disputed, mid-loop,
 * or revised, plus what's awaiting review and what's currently in flight. Read-only — never
 * touches the corpus or any of the loop's own state files, just reports on them.
 *
 * No API key or build step needed (plain Node, no TypeScript imports), unlike every other script
 * in this directory — this only reads local JSON.
 *
 *   node tools/corpus-gen/corpus-stats.mjs [--locale=en] [--evaluation-limit=N]
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTracking, isEvaluationExhausted } from './lib/eval-tracking.mjs';
import { readFeedback } from './lib/corpus-feedback.mjs';
import { readBatchState } from './lib/batch-state.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const IMPROVED_TAG = 'improved-via-feedback-loop';

const rawArgs = process.argv.slice(2);
function flag(name, fallback) {
  const found = rawArgs.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log('Usage: node tools/corpus-gen/corpus-stats.mjs [--locale=en] [--evaluation-limit=N]');
  process.exit(0);
}

const localeFilter = flag('locale');
const evaluationLimit = Number(flag('evaluation-limit', 2));
const locales = localeFilter ? [localeFilter] : ['en', 'nl'];

function identityOf(item) {
  return `${item.key}\u0000${item.persona ?? 'neutral'}`;
}

function pct(n, total) {
  return total === 0 ? '0.0%' : `${((n / total) * 100).toFixed(1)}%`;
}

function line(label, count, total) {
  console.log(`  ${label.padEnd(32, ' ')} ${String(count).padStart(5, ' ')}  (${pct(count, total)})`);
}

for (const locale of locales) {
  const corpusPath = join(root, 'src', 'interpretation', 'corpus', `${locale}.json`);
  let corpus;
  try {
    corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`[${locale}] no corpus file at ${corpusPath} — skipping`);
      continue;
    }
    throw error;
  }

  const tracking = await readTracking(join(root, 'tools', 'corpus-gen', 'eval-tracking', `${locale}.json`));
  const feedback = await readFeedback(join(root, 'tools', 'corpus-gen', 'feedback', `${locale}.json`));
  const evalState = await readBatchState(join(root, 'tools', 'corpus-gen', 'batch-state', `evaluate-${locale}.json`));
  const improveState = await readBatchState(join(root, 'tools', 'corpus-gen', 'batch-state', `improve-${locale}.json`));

  const trackingByIdentity = new Map(tracking.map((r) => [identityOf(r), r]));

  let neverChecked = 0;
  let validated = 0;
  let disputedExhausted = 0;
  let pendingRecheck = 0;
  let improved = 0;

  for (const entry of corpus) {
    if (entry.tags?.includes(IMPROVED_TAG)) improved += 1;
    const rec = trackingByIdentity.get(identityOf(entry));
    if (rec === undefined) {
      neverChecked += 1;
    } else if (rec.clean) {
      validated += 1;
    } else if (isEvaluationExhausted(rec, evaluationLimit)) {
      disputedExhausted += 1;
    } else {
      pendingRecheck += 1;
    }
  }

  const checked = corpus.length - neverChecked;
  const evalJobs = evalState?.jobs ?? [];
  const improveJobs = improveState?.jobs ?? [];
  const inFlightEvalEntries = evalJobs.reduce((sum, job) => sum + job.candidates.length, 0);
  const inFlightImproveEntries = improveJobs.reduce((sum, job) => sum + job.records.length, 0);

  console.log(`\n[${locale}] ${String(corpus.length)} total entries`);
  line('checked (ever evaluated)', checked, corpus.length);
  line('  validated / clean', validated, corpus.length);
  line('  pending re-check (mid-loop)', pendingRecheck, corpus.length);
  line('  disputed, exhausted (stuck)', disputedExhausted, corpus.length);
  line('never checked', neverChecked, corpus.length);
  line('improved (ever revised)', improved, corpus.length);
  console.log(`  ${'awaiting improve (feedback queue)'.padEnd(32, ' ')} ${String(feedback.length).padStart(5, ' ')}`);
  console.log(
    `  ${'in-flight evaluate batches'.padEnd(32, ' ')} ${String(evalJobs.length).padStart(5, ' ')}  job(s), ${String(inFlightEvalEntries)} entries`,
  );
  console.log(
    `  ${'in-flight improve batches'.padEnd(32, ' ')} ${String(improveJobs.length).padStart(5, ' ')}  job(s), ${String(inFlightImproveEntries)} entries`,
  );
}
