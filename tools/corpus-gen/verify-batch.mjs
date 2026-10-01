/**
 * Fact-grounding verification pass for #359: for a locale's shipped corpus
 * (optionally filtered to one category), asks a judge model whether each
 * entry's text is consistent with its own placement's computed facts, and
 * additively tags any flagged entry with `unverified-flagged-by-judge` in
 * its `tags` array. Never touches `reviewedBy`, never deletes or rewrites
 * `text` — this is a triage signal for #292's human review queue, not a
 * gate. Flagged entries still ship; they are only marked for a human's
 * attention, the same non-destructive pattern `classical-triage.mjs` uses.
 *
 * Idempotent: re-running does not add a duplicate tag to an already-flagged
 * entry, and does not re-flag or un-flag an entry across runs — a human who
 * has since looked at a flagged entry (and, say, edited its text via
 * `CorpusOverridesPanel.tsx`) is not silently overridden by a second
 * automated pass; only #292's own review process removes the tag.
 *
 *   npx tsx --env-file=.env.local tools/corpus-gen/verify-batch.mjs --locale=en [--category=<category>] [--provider=gemini|ollama] [--limit=N] [--concurrency=N]
 *
 * The very first intended run of this script is against the *existing*,
 * never-reviewed dignity-state slice, once it's shipped — the honest first
 * trustworthiness signal on corpus content that has been live in production
 * with zero verification of any kind.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVerificationPrompt, VERIFICATION_RESPONSE_SCHEMA } from './lib/verify.mjs';
import { writeCorpus } from './lib/write-corpus.mjs';
import { factsDescription as sharedFactsDescription } from './lib/placements.mjs';
import { categoryOfKey, parsePlacementKey } from '../../src/interpretation/schema.ts';
import { BODIES } from '../../src/astrology/bodies.ts';
import { ASPECTS } from '../../src/astrology/aspects.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FLAG_TAG = 'unverified-flagged-by-judge';

function bodyName(key) {
  return BODIES.find((b) => b.key === key)?.name ?? key;
}

function aspectName(key) {
  return ASPECTS.find((a) => a.key === key)?.name ?? key;
}

/**
 * Renders a placement's own computed facts as plain English — the only ground truth the judge
 * gets. `transit-aspect` isn't in the shared restricted-scope builder (lib/placements.mjs), since
 * generate-batch.mjs's neutral batch doesn't cover it, so it stays a local case here.
 */
function factsDescription(placement) {
  if (placement.category === 'transit-aspect') {
    return `transiting ${bodyName(placement.transiting)} ${aspectName(placement.aspect)} natal ${bodyName(placement.natal)}`;
  }
  return sharedFactsDescription(placement);
}

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
    'Usage: npx tsx --env-file=.env.local tools/corpus-gen/verify-batch.mjs --locale=en [--category=<category>] [--provider=gemini|ollama] [--limit=N] [--concurrency=N]',
  );
  process.exit(0);
}

const locale = flag('locale');
if (locale !== 'en' && locale !== 'nl') throw new Error('--locale=en|nl is required');
const category = flag('category');
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

const candidates = corpus
  .map((entry, index) => ({ entry, index }))
  .filter(({ entry }) => category === undefined || categoryOfKey(entry.key) === category)
  .filter(({ entry }) => !entry.tags.includes(FLAG_TAG))
  .slice(0, Number.isFinite(limit) ? limit : undefined);

console.log(
  `[${locale}] provider: ${provider} (model: ${String(model)}) — ${String(candidates.length)} entries to verify${category ? ` (category=${category})` : ''}`,
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
  const placement = parsePlacementKey(entry.key);
  if (placement === undefined) {
    console.error(`[${locale}] SKIPPED ${entry.key}: could not parse this key back into a placement`);
    return;
  }

  const { systemInstruction, userContent } = buildVerificationPrompt({
    factsDescription: factsDescription(placement),
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
      responseSchema: VERIFICATION_RESPONSE_SCHEMA,
      maxRetries: 5,
    });

    if (result.grounded === false) {
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
  `\n[${locale}] verification complete: ${String(candidates.length)} checked, ${String(flagged)} newly flagged, ${String(failed)} failed`,
);
