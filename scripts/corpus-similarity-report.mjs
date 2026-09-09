/**
 * Similarity report artefact for #58: runs the trigram dedupe pass
 * (src/interpretation/dedupe.ts) over the whole shipped corpus and prints
 * which pairs read too much alike to ship as two separate entries.
 *
 *   node scripts/corpus-similarity-report.mjs                  print to stdout
 *   node scripts/corpus-similarity-report.mjs --out FILE        also write to FILE
 *   node scripts/corpus-similarity-report.mjs --threshold 0.6   override the default
 *
 * Exits non-zero when any pair is flagged, so this can gate CI once #55/#56
 * have put content in the corpus for it to find something in.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findNearDuplicates, formatSimilarityReport } from '../src/interpretation/dedupe.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// dedupe.ts only ever imports schema.ts as types, which Node's type-stripping
// erases entirely — so it loads standalone. index.ts does not: it imports
// loader.js (loader.ts, under the .js-specifier convention this project's
// TypeScript uses), and Node's runtime, unlike tsc/vite, resolves that
// specifier literally rather than mapping it back to the .ts file. So the
// corpus is read here as plain JSON instead of going through the loader —
// this script's job is similarity, not the shape/parity validation the
// loader and its own tests already cover.
async function readCorpus(locale) {
  const path = join(root, 'src', 'interpretation', 'corpus', `${locale}.json`);
  const entries = JSON.parse(await readFile(path, 'utf8'));
  return entries.map((entry) => ({ ...entry, locale }));
}

const corpus = [...(await readCorpus('en')), ...(await readCorpus('nl'))];

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

const thresholdArg = argValue('--threshold');
const threshold = thresholdArg === undefined ? undefined : Number(thresholdArg);
if (threshold !== undefined && !Number.isFinite(threshold)) {
  throw new Error(`corpus-similarity-report: --threshold must be a number, got ${thresholdArg}`);
}

const report = findNearDuplicates(corpus, threshold);
const text = formatSimilarityReport(report);

console.log(text);

const outArg = argValue('--out');
if (outArg !== undefined) {
  const outPath = resolve(root, outArg);
  await writeFile(outPath, `${text}\n`);
  console.log(`\nWrote report to ${outPath}`);
}

if (report.pairs.length > 0) process.exit(1);
