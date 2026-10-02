/**
 * One-time (but kept as a real script, not a throwaway, in case a future body addition ever
 * recreates this situation) cleanup for #395: removes every aspect-pair/synastry-aspect entry
 * where both bodies are calculation-method variants of the same real point (meanNode/trueNode,
 * meanLilith/osculatingLilith/interpolatedLilith) — see lib/placements.mjs's `corePairs()` doc
 * comment for why these never carried independent astrological meaning. That fix stops *future*
 * generation from ever producing these; this removes the ones that already shipped before it
 * landed, which is why #381's feedback loop could never converge on them — the two judge models
 * were correctly disagreeing about an entry whose premise is the actual problem, not its wording.
 *
 * Same dry-run-by-default/backup/concurrent-generation-guard shape as remove-by-tag.mjs and
 * remove-by-model.mjs — see those for the convention this doesn't repeat. Also drops matching
 * identities from eval-tracking/<locale>.json and feedback/<locale>.json so no orphaned state
 * about an entry that no longer exists lingers in either.
 *
 *   npx tsx tools/corpus-gen/remove-same-point-variant-pairs.mjs --locale=en [--apply]
 */
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeCorpusEntries } from './lib/write-corpus.mjs';
import { readTracking, writeTracking } from './lib/eval-tracking.mjs';
import { readFeedback, writeFeedback, removeFeedback } from './lib/corpus-feedback.mjs';
import { BODIES } from '../../src/astrology/bodies.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SAME_POINT_VARIANT_CATEGORIES = new Set(['node', 'lilith']);

function categoryOf(bodyKey) {
  return BODIES.find((b) => b.key === bodyKey)?.category;
}

/** True for an aspect-pair/synastry-aspect key whose two bodies are variants of the same point. */
function isSamePointVariantEntry(entry) {
  const parts = entry.key.split(':');
  if (parts[0] !== 'aspect-pair' && parts[0] !== 'synastry-aspect') return false;
  const [, , bodyA, bodyB] = parts;
  const a = categoryOf(bodyA);
  const b = categoryOf(bodyB);
  return a !== undefined && a === b && SAME_POINT_VARIANT_CATEGORIES.has(a);
}

const rawArgs = process.argv.slice(2);
function flag(name, fallback) {
  const found = rawArgs.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log('Usage: npx tsx tools/corpus-gen/remove-same-point-variant-pairs.mjs --locale=en [--apply]');
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

const matching = corpus.filter(isSamePointVariantEntry);
console.log(
  `[${locale}] ${String(matching.length)} entr${matching.length === 1 ? 'y' : 'ies'} are same-point-variant aspect pairs.`,
);
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

const { removedKeys } = await removeCorpusEntries(corpusPath, isSamePointVariantEntry);
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
