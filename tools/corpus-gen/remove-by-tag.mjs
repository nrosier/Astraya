/**
 * Cleanup tool: removes every entry whose `tags` includes `--tag`, for one
 * locale's corpus file — e.g. to strip out everything
 * `language-quality-batch.mjs` flagged as `language-quality-flagged-by-judge`
 * (wrong language, or a problem it wasn't confident how to fix), without
 * touching anything else. `remove-by-model.mjs`'s own sibling, filtering by
 * `tags` instead of `provenance.model` — same dry-run-by-default, same
 * backup-then-surgical-delete, same concurrent-generation guard, for the
 * same reasons; see that file's own doc comment for the detail this one
 * doesn't repeat.
 *
 * Removed keys become "genuinely missing" to generate-batch.mjs's own
 * gap-filler logic, so a plain (non `--force`) re-run of that script against
 * the same locale regenerates exactly those — the actual revert-then-
 * regenerate half of the language-quality workflow. Same shape as #371's
 * precedent for the Mistral synastry-aspect batch.
 *
 *   npx tsx tools/corpus-gen/remove-by-tag.mjs --locale=en --tag=<tag> [--apply]
 */
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import { execSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { removeCorpusEntries } from './lib/write-corpus.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const rawArgs = process.argv.slice(2);
function flag(name, fallback) {
  const found = rawArgs.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log('Usage: npx tsx tools/corpus-gen/remove-by-tag.mjs --locale=en --tag=<tag> [--apply]');
  process.exit(0);
}

const locale = flag('locale');
if (!locale) throw new Error('--locale=<locale> is required');
const tag = flag('tag');
if (!tag) throw new Error('--tag=<tag> is required — e.g. --tag=language-quality-flagged-by-judge');
const apply = rawArgs.includes('--apply');

function assertNoConcurrentGeneration(locale) {
  let psOutput;
  try {
    psOutput = execSync('ps aux', { encoding: 'utf8' });
  } catch {
    return; // ps unavailable — fail open rather than block on a platform where this can't check
  }
  const pattern = new RegExp(`generate-batch\\.mjs[^\\n]*--locale=${locale}\\b`);
  if (pattern.test(psOutput)) {
    throw new Error(
      `a generate-batch.mjs process appears to be running for --locale=${locale} right now — ` +
        'removing entries while it runs risks a crash or a silently-resurrected entry on its next ' +
        'write. Wait for it to finish, or stop it, first.',
    );
  }
}

if (apply) assertNoConcurrentGeneration(locale);

const corpusPath = join(root, 'src', 'interpretation', 'corpus', `${locale}.json`);
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));

function matches(entry) {
  return entry.tags?.includes(tag) ?? false;
}

const matching = corpus.filter(matches);
console.log(`[${locale}] ${String(matching.length)} entr${matching.length === 1 ? 'y' : 'ies'} tagged "${tag}".`);
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

const { removedKeys } = await removeCorpusEntries(corpusPath, matches);
console.log(`[${locale}] removed ${String(removedKeys.length)} entr${removedKeys.length === 1 ? 'y' : 'ies'}.`);
