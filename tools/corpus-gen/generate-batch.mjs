/**
 * Batch runner for #56's default/neutral corpus entries: the persona-less
 * text every reader sees before choosing a more particular voice, and the
 * fallback a persona-specific lookup lands on when its own entry doesn't
 * exist yet (#211).
 *
 * planet-in-sign/-house and aspect-pair cover every computed body (all 20 —
 * the 10 traditional/modern planets, both nodes, all three Lilith variants
 * and the four main-belt asteroids), so no placement a chart can produce is
 * left without a default entry. dignity-state stays restricted to the 7
 * bodies with a defined traditional rulership — that one is a correctness
 * constraint, not a scope choice: Pluto, an asteroid, etc. have no classical
 * dignity to describe, so generating one would be inventing astrology, not
 * omitting coverage. synastry-aspect (#359) reuses aspect-pair's own
 * corePairs() x ASPECTS coverage — the neutral entry describes the pair's
 * dynamic regardless of which chart owns which body, mirroring aspect-pair's
 * own symmetric phrasing.
 *
 * Resumable and idempotent: every successful entry is written to
 * src/interpretation/corpus/<locale>.json immediately, and a re-run skips
 * any key that file already has (as a neutral entry — persona-specific
 * entries for the same key don't count as coverage here). Runs one locale
 * at a time by design, so `--locale=en` and `--locale=nl` can run
 * concurrently or be resumed independently, per #56.
 *
 *   npx tsx --env-file=.env.local tools/corpus-gen/generate-batch.mjs --locale=en [--persona=<id>] [--limit=N] [--concurrency=N] [--delay-ms=N] [--skip-final-checks] [--provider=gemini|ollama]
 *
 * `--persona` (a `tools/corpus-gen/personas.json` id) generates that
 * persona's voice for each placement instead of the neutral default;
 * omitting it keeps the original neutral-only behavior. Coverage/resume is
 * scoped to `(key, persona)`, matching the corpus's own dedupe identity
 * (schema.ts / loader.ts). `--skip-final-checks` skips the whole-locale
 * lint/dedupe pass at the end — useful when running many persona rounds
 * back-to-back, since that pass is quadratic in the locale's total entry
 * count and repeating it after every round pays a rising cost for no benefit
 * until the last round is done anyway.
 *
 * `--provider=gemini|ollama` (#359, default gemini) picks which machine runs
 * this: Ollama only ever runs against whoever's own machine has it
 * installed, so `--provider=ollama` is for local/dev generation. Actually
 * regenerating the corpus for the production/hosted deployment stays on
 * Gemini for now — a hosted environment has no local model to call.
 */
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemInstruction, buildUserContent } from './lib/prompt.mjs';
import { writeCorpus } from './lib/write-corpus.mjs';
import { CORPUS_ENTRY_RESPONSE_SCHEMA, placementKey } from '../../src/interpretation/schema.ts';
import { buildSymbolismContext, planetSymbolism, signSymbolism } from '../../src/interpretation/symbolism.ts';
import { lintCorpus } from '../../src/interpretation/lint.ts';
import { findNearDuplicates } from '../../src/interpretation/dedupe.ts';
import { BODIES } from '../../src/astrology/bodies.ts';
import { SIGNS } from '../../src/astrology/signs.ts';
import { ASPECTS } from '../../src/astrology/aspects.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOUSES = Array.from({ length: 12 }, (_, i) => i + 1);
const SIGN_INDICES = SIGNS.map((s) => s.index);
const DIGNITY_STATES = ['ruler', 'exalted', 'detriment', 'fall'];

/** Every computed body — planet-in-sign/-house and aspect-pair cover all of them. */
const CORE_BODY_KEYS = BODIES.map((b) => b.key);
/** The 7 bodies with a defined traditional rulership — the only ones dignity-state means anything for. */
const TRADITIONAL_RULER_KEYS = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn'];

function corePairs() {
  const keys = [...CORE_BODY_KEYS].sort();
  const pairs = [];
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) pairs.push([keys[i], keys[j]]);
  }
  return pairs;
}

/** The full restricted placement scope, in a fixed, deterministic order. */
function buildPlacements() {
  const placements = [];
  for (const body of CORE_BODY_KEYS) {
    for (const sign of SIGN_INDICES) placements.push({ category: 'planet-in-sign', body, sign });
  }
  for (const body of CORE_BODY_KEYS) {
    for (const house of HOUSES) placements.push({ category: 'planet-in-house', body, house });
  }
  for (const sign of SIGN_INDICES) {
    for (const house of HOUSES) placements.push({ category: 'sign-on-cusp', sign, house });
  }
  for (const aspect of ASPECTS) {
    for (const [bodyA, bodyB] of corePairs())
      placements.push({ category: 'aspect-pair', aspect: aspect.key, bodyA, bodyB });
  }
  // synastry-aspect (#359) mirrors aspect-pair's corePairs() x ASPECTS shape — the batch
  // default entry is written for the pair regardless of which side is "this chart" vs
  // "the other chart", same as aspect-pair's own symmetric text.
  for (const aspect of ASPECTS) {
    for (const [bodyA, bodyB] of corePairs())
      placements.push({ category: 'synastry-aspect', aspect: aspect.key, bodyA, bodyB });
  }
  for (const body of TRADITIONAL_RULER_KEYS) {
    for (const state of DIGNITY_STATES) placements.push({ category: 'dignity-state', body, state });
  }
  return placements;
}

function placementDescription(placement) {
  const bodyName = (key) => BODIES.find((b) => b.key === key)?.name ?? key;
  switch (placement.category) {
    case 'planet-in-sign':
      return `${bodyName(placement.body)} in ${SIGNS[placement.sign]?.name ?? String(placement.sign)} (${planetSymbolism(placement.body)?.core ?? ''} / ${signSymbolism(placement.sign)?.core ?? ''})`;
    case 'planet-in-house':
      return `${bodyName(placement.body)} in house ${String(placement.house)} (${planetSymbolism(placement.body)?.core ?? ''})`;
    case 'sign-on-cusp':
      return `${SIGNS[placement.sign]?.name ?? String(placement.sign)} on the cusp of house ${String(placement.house)} (${signSymbolism(placement.sign)?.core ?? ''})`;
    case 'aspect-pair':
      return `${bodyName(placement.bodyA)} ${placement.aspect} ${bodyName(placement.bodyB)}`;
    case 'synastry-aspect':
      return `synastry: ${bodyName(placement.bodyA)} ${placement.aspect} ${bodyName(placement.bodyB)} (cross-chart)`;
    case 'dignity-state':
      return `${bodyName(placement.body)} in ${placement.state}`;
    default:
      throw new Error(`unreachable: unhandled category "${placement.category}"`);
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
const locale = flag('locale');
if (locale !== 'en' && locale !== 'nl') throw new Error('--locale=en|nl is required');
const limit = Number(flag('limit', Infinity));
const concurrency = Number(flag('concurrency', '3'));
const delayMs = Number(flag('delay-ms', '200'));
const skipFinalChecks = rawArgs.includes('--skip-final-checks');

const provider = flag('provider', 'gemini');
if (provider !== 'gemini' && provider !== 'ollama')
  throw new Error(`--provider must be "gemini" or "ollama", got "${provider}"`);
const { generateStructured } = await import(provider === 'ollama' ? './lib/ollama.mjs' : './lib/gemini.mjs');
const model = provider === 'ollama' ? process.env.OLLAMA_MODEL || 'mistral' : process.env.GEMINI_MODEL;
const baseUrl = provider === 'ollama' ? process.env.OLLAMA_BASE_URL : process.env.GEMINI_BASE_URL;

const personas = JSON.parse(await readFile(join(root, 'tools', 'corpus-gen', 'personas.json'), 'utf8')).personas;
const personaIdFlag = flag('persona');
const persona = personaIdFlag ? personas.find((p) => p.id === personaIdFlag) : undefined;
if (personaIdFlag && !persona) {
  throw new Error(`unknown persona "${personaIdFlag}" — known: ${personas.map((p) => p.id).join(', ')}`);
}
const scopeLabel = persona?.id ?? 'neutral';

const corpusPath = join(root, 'src', 'interpretation', 'corpus', `${locale}.json`);
let corpus;
try {
  corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
} catch (error) {
  // No corpus file for this locale yet: start from scratch rather than crashing — writeCorpus()
  // (called via persist(), below) bootstraps the same way once the first entry is generated.
  if (error.code !== 'ENOENT') throw error;
  corpus = [];
}
// buildAnchorsBlock() (lib/prompt.mjs) requires at least one hand-written `anchor: true` entry
// for this locale to few-shot every prompt against — #56's "3 gold-standard fragments". A
// from-scratch corpus has none, and there's no way to conjure a hand-written example
// mechanically (schema.ts requires anchor entries to be hand-written or human-reviewed), so
// this has to come from somewhere real: either the corpus already has them, or a caller points
// at a backup/git-restored file that does.
if (corpus.filter((e) => e.anchor === true && e.locale === locale).length === 0) {
  const seedAnchorsFrom = flag('seed-anchors-from');
  if (!seedAnchorsFrom) {
    throw new Error(
      `no anchor entries (anchor: true) found for locale "${locale}" — 3 hand-written gold-standard examples ` +
        `are required to prompt the model, and a from-scratch corpus has none.\n` +
        `Point --seed-anchors-from=<path> at a corpus file that still has them (a backup, or a git-restored ` +
        `copy), e.g.:\n` +
        `  git show HEAD:src/interpretation/corpus/${locale}.json > /tmp/${locale}-anchors-source.json\n` +
        `  npx tsx --env-file=.env.local tools/corpus-gen/generate-batch.mjs --locale=${locale} --provider=${provider} --seed-anchors-from=/tmp/${locale}-anchors-source.json`,
    );
  }
  const seedCorpus = JSON.parse(await readFile(resolve(seedAnchorsFrom), 'utf8'));
  const seedAnchors = seedCorpus.filter((e) => e.anchor === true && e.locale === locale);
  if (seedAnchors.length === 0) {
    throw new Error(`--seed-anchors-from=${seedAnchorsFrom} has no anchor entries for locale "${locale}" either`);
  }
  corpus.push(...seedAnchors);
  await writeCorpus(corpusPath, corpus);
  console.log(
    `[${locale}/${scopeLabel}] seeded ${String(seedAnchors.length)} anchor entr${seedAnchors.length === 1 ? 'y' : 'ies'} from ${seedAnchorsFrom}`,
  );
}

const existingKeys = new Set(corpus.filter((e) => e.persona === persona?.id).map((e) => e.key));

const allPlacements = buildPlacements();
const pending = allPlacements
  .map((placement) => ({ placement, key: placementKey(placement) }))
  .filter(({ key }) => !existingKeys.has(key))
  .slice(0, Number.isFinite(limit) ? limit : undefined);

console.log(
  `[${locale}/${scopeLabel}] provider: ${provider} (model: ${String(model)}) — restricted scope: ${String(allPlacements.length)} placements, ${String(existingKeys.size)} already shipped, ${String(pending.length)} to generate`,
);
if (pending.length === 0) {
  console.log(`[${locale}/${scopeLabel}] nothing to do.`);
  process.exit(0);
}

let usageIn = 0;
let usageOut = 0;
let done = 0;
let failed = 0;
const lock = { writing: Promise.resolve() };

// A redrawing bar only makes sense against a real terminal — piped to a file or CI log, `\r`
// just produces one giant unreadable line, so fall back to the old periodic plain-line logging.
const useProgressBar = process.stdout.isTTY === true;
const BAR_WIDTH = 30;
function renderProgress() {
  const finished = done + failed;
  const pct = pending.length > 0 ? finished / pending.length : 1;
  const filled = Math.round(pct * BAR_WIDTH);
  const bar = '#'.repeat(filled) + '-'.repeat(BAR_WIDTH - filled);
  const elapsedMin = (Date.now() - startedAt) / 60000;
  const etaMin = finished > 0 ? (elapsedMin / finished) * (pending.length - finished) : 0;
  const rate = finished > 0 ? finished / elapsedMin : 0;
  const line =
    `[${locale}/${scopeLabel}] [${bar}] ${String(finished)}/${String(pending.length)} (${(pct * 100).toFixed(1)}%)` +
    ` — ${String(done)} ok, ${String(failed)} failed — ${elapsedMin.toFixed(1)}min elapsed, ~${etaMin.toFixed(1)}min left` +
    ` — ${rate.toFixed(1)}/min`;
  process.stdout.write(`\r${line.padEnd(process.stdout.columns ?? line.length)}`);
}

async function persist() {
  lock.writing = lock.writing.then(() => writeCorpus(corpusPath, corpus));
  await lock.writing;
}

const startedAt = Date.now();

await withConcurrency(pending, concurrency, async ({ placement, key }) => {
  const description = placementDescription(placement);
  const systemInstruction = buildSystemInstruction({
    persona,
    symbolismContext: buildSymbolismContext(locale),
    locale,
  });
  const userContent = buildUserContent({ placementDescription: description, corpusEntries: corpus, locale, persona });

  try {
    const result = await generateStructured({
      apiKey: process.env.GEMINI_API_KEY,
      model,
      baseUrl,
      temperature: Number(process.env.GEMINI_TEMPERATURE ?? '0.75'),
      systemInstruction,
      userContent,
      responseSchema: CORPUS_ENTRY_RESPONSE_SCHEMA,
      maxRetries: 5,
      onUsage: (usage) => {
        usageIn += usage?.promptTokenCount ?? 0;
        usageOut += usage?.candidatesTokenCount ?? 0;
      },
    });

    const entry = {
      key,
      locale,
      text: result.text,
      tier: result.tier,
      tags: placement.category === 'dignity-state' ? [placement.state] : [],
      ...(persona ? { persona: persona.id } : {}),
      provenance: {
        source: 'generated',
        model,
        generatedAt: new Date().toISOString().slice(0, 10),
      },
    };
    corpus.push(entry);
    await persist();
    done += 1;
    if (useProgressBar) {
      renderProgress();
    } else if (done % 10 === 0 || done === pending.length) {
      const elapsedMin = (Date.now() - startedAt) / 60000;
      const rate = done / elapsedMin;
      console.log(
        `[${locale}/${scopeLabel}] ${String(done)}/${String(pending.length)} written (${elapsedMin.toFixed(1)} min elapsed, ${rate.toFixed(1)}/min) — last: ${key}`,
      );
    }
  } catch (error) {
    failed += 1;
    if (useProgressBar) process.stdout.write('\n');
    console.error(`[${locale}/${scopeLabel}] FAILED ${key}: ${error.message}`);
    if (useProgressBar) renderProgress();
  }

  if (delayMs > 0) await sleep(delayMs);
});

console.log(`\n[${locale}/${scopeLabel}] batch complete: ${String(done)} written, ${String(failed)} failed`);

if (provider === 'ollama') {
  console.log(
    `[${locale}/${scopeLabel}] usage: ${String(usageIn)} input tokens, ${String(usageOut)} output tokens — $0.00 (local model)`,
  );
} else {
  const inputCostPerM = 0.3;
  const outputCostPerM = 2.5;
  const cost = (usageIn / 1_000_000) * inputCostPerM + (usageOut / 1_000_000) * outputCostPerM;
  console.log(
    `[${locale}/${scopeLabel}] usage: ${String(usageIn)} input tokens, ${String(usageOut)} output tokens — est. cost at Standard-tier rates: $${cost.toFixed(2)}`,
  );
}

if (skipFinalChecks) {
  console.log(`\n[${locale}/${scopeLabel}] --skip-final-checks set: skipping whole-locale lint/dedupe pass.`);
  process.exit(0);
}

console.log(`\n[${locale}/${scopeLabel}] final lint pass over the whole locale:`);
const lintIssues = lintCorpus(corpus);
if (lintIssues.length === 0) console.log(`[${locale}/${scopeLabel}] clean — no lint issues`);
else for (const issue of lintIssues) console.log(`  [${issue.rule}] ${issue.key}: ${issue.message}`);

console.log(`\n[${locale}/${scopeLabel}] final dedupe pass over the whole locale:`);
const { pairs } = findNearDuplicates(corpus);
if (pairs.length === 0) console.log(`[${locale}/${scopeLabel}] clean — no near-duplicates at or above the threshold`);
else for (const pair of pairs) console.log(`  ${pair.keyA} <-> ${pair.keyB}: ${pair.similarity.toFixed(3)}`);
