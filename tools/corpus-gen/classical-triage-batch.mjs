/**
 * Classical-source triage batch runner for #359, `dignity-state` only: for
 * each shipped `dignity-state` entry, looks up its excerpt in
 * `classical-texts/dignity-state.en.json` (William Lilly, Christian
 * Astrology, 1647 — see that file for full provenance) and asks a judge
 * model whether the entry substantively agrees with it, additively tagging
 * any divergence with `diverges-from-classical-source`. Never touches
 * `reviewedBy`, never deletes or rewrites `text` — a triage signal for
 * #292's human review queue, same non-destructive pattern as
 * `verify-batch.mjs`. Flagged entries still ship.
 *
 *   npx tsx --env-file=.env.local tools/corpus-gen/classical-triage-batch.mjs [--provider=gemini|ollama] [--limit=N] [--concurrency=N]
 *
 * English-only for now: the sourced excerpts are all in English (Dutch
 * native sourcing is explicitly out of scope for this increment), so this
 * only ever runs against `src/interpretation/corpus/en.json`.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildClassicalTriagePrompt, CLASSICAL_TRIAGE_RESPONSE_SCHEMA } from './lib/classical-triage.mjs';
import { writeCorpus } from './lib/write-corpus.mjs';
import { categoryOfKey } from '../../src/interpretation/schema.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FLAG_TAG = 'diverges-from-classical-source';

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
    'Usage: npx tsx --env-file=.env.local tools/corpus-gen/classical-triage-batch.mjs [--provider=gemini|ollama] [--limit=N] [--concurrency=N]',
  );
  process.exit(0);
}

const locale = 'en';
const limit = Number(flag('limit', Infinity));
const concurrency = Number(flag('concurrency', '3'));

const provider = flag('provider', 'gemini');
if (provider !== 'gemini' && provider !== 'ollama')
  throw new Error(`--provider must be "gemini" or "ollama", got "${provider}"`);
const { generateStructured } = await import(provider === 'ollama' ? './lib/ollama.mjs' : './lib/gemini.mjs');
const model = provider === 'ollama' ? process.env.OLLAMA_MODEL || 'gemma4' : process.env.GEMINI_MODEL;
const baseUrl = provider === 'ollama' ? process.env.OLLAMA_BASE_URL : process.env.GEMINI_BASE_URL;

const corpusPath = join(root, 'src', 'interpretation', 'corpus', `${locale}.json`);
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));

const classicalTextsPath = join(root, 'tools', 'corpus-gen', 'classical-texts', 'dignity-state.en.json');
const { excerpts } = JSON.parse(await readFile(classicalTextsPath, 'utf8'));

const candidates = corpus
  .map((entry, index) => ({ entry, index }))
  .filter(({ entry }) => categoryOfKey(entry.key) === 'dignity-state')
  .filter(({ entry }) => !entry.tags.includes(FLAG_TAG))
  .filter(({ entry }) => entry.key in excerpts)
  .slice(0, Number.isFinite(limit) ? limit : undefined);

console.log(
  `[${locale}] provider: ${provider} (model: ${String(model)}) — ${String(candidates.length)} dignity-state entries to triage against the classical source`,
);
if (candidates.length === 0) {
  console.log(`[${locale}] nothing to do.`);
  process.exit(0);
}

let flagged = 0;
let failed = 0;
const lock = { writing: Promise.resolve() };

async function persist() {
  lock.writing = lock.writing.then(() => writeCorpus(corpusPath, corpus));
  await lock.writing;
}

await withConcurrency(candidates, concurrency, async ({ entry, index }) => {
  const { systemInstruction, userContent } = buildClassicalTriagePrompt({
    classicalExcerpt: excerpts[entry.key],
    entryText: entry.text,
    locale,
  });

  try {
    const result = await generateStructured({
      apiKey: process.env.GEMINI_API_KEY,
      model,
      baseUrl,
      temperature: 0,
      systemInstruction,
      userContent,
      responseSchema: CLASSICAL_TRIAGE_RESPONSE_SCHEMA,
      maxRetries: 5,
    });

    if (result.matches === false) {
      corpus[index] = { ...entry, tags: [...entry.tags, FLAG_TAG] };
      await persist();
      flagged += 1;
      console.log(`[${locale}] FLAGGED ${entry.key}: ${result.issues.join(' / ')}`);
    }
  } catch (error) {
    failed += 1;
    console.error(`[${locale}] FAILED ${entry.key}: ${error.message}`);
  }
});

console.log(
  `\n[${locale}] classical triage complete: ${String(candidates.length)} checked, ${String(flagged)} newly flagged, ${String(failed)} failed`,
);
