/**
 * #396: removes every aspect-pair/synastry-aspect entry whose aspect is in the quintile series
 * (quintile, biquintile — aspects.ts's own doc comment) so a plain (non `--force`)
 * generate-batch.mjs run regenerates exactly those under the corrected prompt
 * (lib/prompt.mjs's `aspectFlavorHint`), same "removed key becomes genuinely missing to the
 * gap-filler" mechanism remove-by-tag.mjs/remove-by-model.mjs already rely on.
 *
 * Removes *every* quintile-series entry, not just the disputed ones: ~68% of them were only
 * "clean" after one or more reactive rewrites made blind to the real fix (no instruction existed
 * yet about what flavor to aim for), and the remaining ~31% that passed on the first try have no
 * particular evidence of being better than what a properly-guided fresh generation produces —
 * unlike #395's fix, this one changes what the *generator* produces, not just how the judge
 * scores it, so a currently-clean entry's text can genuinely improve under the new prompt.
 *
 * Same dry-run-by-default/backup/concurrent-generation-guard shape as remove-by-tag.mjs,
 * remove-by-model.mjs, and remove-same-point-variant-pairs.mjs. Also drops matching identities
 * from eval-tracking/<locale>.json and feedback/<locale>.json — stale loop state about an entry
 * that's about to be regenerated from scratch would just be noise once it exists again.
 *
 *   npx tsx tools/corpus-gen/remove-quintile-series-entries.mjs --locale=en [--apply]
 */
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeCorpusEntries } from './lib/write-corpus.mjs';
import { readTracking, writeTracking } from './lib/eval-tracking.mjs';
import { readFeedback, writeFeedback, removeFeedback } from './lib/corpus-feedback.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const QUINTILE_SERIES_ASPECTS = new Set(['quintile', 'biquintile']);

function isQuintileSeriesEntry(entry) {
  const parts = entry.key.split(':');
  return (parts[0] === 'aspect-pair' || parts[0] === 'synastry-aspect') && QUINTILE_SERIES_ASPECTS.has(parts[1]);
}

const rawArgs = process.argv.slice(2);
function flag(name, fallback) {
  const found = rawArgs.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log('Usage: npx tsx tools/corpus-gen/remove-quintile-series-entries.mjs --locale=en [--apply]');
  process.exit(0);
}

const locale = flag('locale');
if (!locale) throw new Error('--locale=<locale> is required');
const apply = rawArgs.includes('--apply');

function assertNoConcurrentGeneration(locale) {
  let psOutput;
  try {
    psOutput = execSync('ps aux', { encoding: 'utf8' });
  } catch {
    return; // ps unavailable — fail open rather than block on a platform where this can't check
  }
  const pattern = new RegExp(`(generate|evaluate|improve)-batch\\.mjs[^\\n]*--locale=${locale}\\b`);
  if (pattern.test(psOutput)) {
    throw new Error(
      `a batch script appears to be running for --locale=${locale} right now — removing entries ` +
        'while it runs risks a crash or a silently-resurrected entry on its next write. Wait for ' +
        'it to finish, or stop it, first.',
    );
  }
}

if (apply) assertNoConcurrentGeneration(locale);

const corpusPath = join(root, 'src', 'interpretation', 'corpus', `${locale}.json`);
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));

const matching = corpus.filter(isQuintileSeriesEntry);
console.log(`[${locale}] ${String(matching.length)} quintile-series entr${matching.length === 1 ? 'y' : 'ies'}.`);
for (const entry of matching.slice(0, 20)) console.log(`  ${entry.key}${entry.persona ? ` (${entry.persona})` : ''}`);
if (matching.length > 20) console.log(`  ... and ${String(matching.length - 20)} more`);

if (matching.length === 0) {
  console.log(`[${locale}] nothing to do.`);
  process.exit(0);
}

if (!apply) {
  console.log(
    `\n[${locale}] dry run — nothing written. Re-run with --apply to actually remove ${String(matching.length)} entr${matching.length === 1 ? 'y' : 'ies'}.`,
  );
  process.exit(0);
}

const backupDir = join(root, 'tools', 'corpus-gen', 'backups');
await mkdir(backupDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = join(backupDir, `${locale}.${timestamp}.json`);
await copyFile(corpusPath, backupPath);
console.log(`[${locale}] backed up current corpus to ${backupPath}`);

const { removedKeys } = await removeCorpusEntries(corpusPath, isQuintileSeriesEntry);
console.log(
  `[${locale}] removed ${String(removedKeys.length)} entr${removedKeys.length === 1 ? 'y' : 'ies'} from the corpus.`,
);

const trackingPath = join(root, 'tools', 'corpus-gen', 'eval-tracking', `${locale}.json`);
const tracking = await readTracking(trackingPath);
const removedIdentity = new Set(matching.map((e) => `${e.key}\u0000${e.persona ?? 'neutral'}`));
const keptTracking = tracking.filter((r) => !removedIdentity.has(`${r.key}\u0000${r.persona ?? 'neutral'}`));
if (keptTracking.length !== tracking.length) {
  await writeTracking(trackingPath, keptTracking);
  console.log(`[${locale}] dropped ${String(tracking.length - keptTracking.length)} orphaned eval-tracking record(s).`);
}

const feedbackPath = join(root, 'tools', 'corpus-gen', 'feedback', `${locale}.json`);
const feedback = await readFeedback(feedbackPath);
const feedbackBefore = feedback.length;
for (const entry of matching) removeFeedback(feedback, entry);
if (feedback.length !== feedbackBefore) {
  await writeFeedback(feedbackPath, feedback);
  console.log(`[${locale}] dropped ${String(feedbackBefore - feedback.length)} orphaned feedback record(s).`);
}
