/**
 * #368 — samples a representative slice of a category's placement space,
 * generates candidate text for each with the real production prompt builder
 * (lib/prompt.mjs), and evaluates it against Astraya's own internal
 * fact-grounding (lib/verify.mjs's judge, same mechanism verify-batch.mjs
 * already uses for shipped entries) plus the corpus lint pass — never
 * against a third-party astrology API (that's #368's own still-undecided
 * Part 1, tracked separately by the unused ASTROLOGYAPI_API_KEY / not-yet-
 * built benchmark-batch.mjs pairing in .env.local; this tool doesn't need
 * that decision to be useful today).
 *
 * Report-only, like scripts/corpus-similarity-report.mjs: always printed to
 * stdout, optionally also written to --out. Never writes to the shipped
 * corpus — candidates sampled here aren't shipped entries (this tool is
 * meant to run against a category with little or no coverage yet, e.g.
 * synastry-aspect post-#371's revert), so there's nothing to tag the way
 * verify-batch.mjs tags existing entries.
 *
 *   npx tsx --env-file=.env.local tools/corpus-gen/sample-validate-batch.mjs --category=synastry-aspect [--locale=nl] [--sample-size=18] [--provider=ollama|gemini] [--judge-provider=gemini|ollama] [--seed=N] [--out=FILE]
 *
 * `--provider` (default ollama) is the generator being validated;
 * `--judge-provider` (default gemini) must differ from it unless
 * `--allow-same-provider-judge` is passed — a same-model judge grading its
 * own homework defeats the point of an independent fact-grounding check.
 *
 * When the clean rate is low, the report's "propose solutions" section
 * explicitly suggests generating and validating a comparison sample with an
 * alternate OLLAMA_MODEL (e.g. gemma4, found in this project's own #371
 * investigation to be far more reliable than Mistral for Dutch generation)
 * rather than only recommending "don't use this provider" — the user's own
 * framing for what #368 should do when it detects too many issues.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemInstruction, buildUserContent } from './lib/prompt.mjs';
import { buildVerificationPrompt, VERIFICATION_RESPONSE_SCHEMA } from './lib/verify.mjs';
import {
  buildPlacements,
  placementDescription,
  factsDescription,
  buildSymbolismContext,
  ASPECTS,
} from './lib/placements.mjs';
import { CORPUS_ENTRY_RESPONSE_SCHEMA } from '../../src/interpretation/schema.ts';
import { lintEntry } from '../../src/interpretation/lint.ts';
import { estimateCostCentsForCall, formatCents } from './lib/cost-estimate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// The actual combinatorial shape of an aspect-based category's long tail: a handful of common
// luminaries/planets crossed with the rarer bodies (asteroids, Lilith variants, nodes, Chiron).
// synastry-aspect was assigned to Ollama for this sheer volume/cost reason, not because it's
// lower priority — the report says so explicitly, so a low clean rate here isn't read as "this
// category matters less."
const COMMON_BODIES = ['sun', 'moon', 'venus', 'mars', 'saturn'];
const RARE_BODIES = ['chiron', 'ceres', 'juno', 'meanLilith', 'trueNode', 'vesta'];
// Roughly matches this session's own manually-validated 15-major/3-minor split (18 total),
// generalized to any --sample-size and spread across every major/minor aspect key rather than a
// hand-picked subset of minor ones.
const MAJOR_SHARE = 0.8;

function seededShuffle(arr, seed) {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Splits `count` as evenly as possible across `n` buckets. */
function evenSplit(count, n) {
  const base = Math.floor(count / n);
  const remainder = count % n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Stratified sample for an aspect-shaped category (bodyA/bodyB + aspect), by aspect family. */
function sampleAspectPairs(category, sampleSize, seed) {
  const majorKeys = ASPECTS.filter((a) => a.family === 'major').map((a) => a.key);
  const minorKeys = ASPECTS.filter((a) => a.family === 'minor').map((a) => a.key);
  const majorTotal = Math.round(sampleSize * MAJOR_SHARE);
  const minorTotal = sampleSize - majorTotal;
  const pool = COMMON_BODIES.flatMap((c) => RARE_BODIES.map((r) => [c, r]));

  const pairs = [];
  let poolSeed = seed;
  function nextFromPool(count) {
    poolSeed += 1;
    return seededShuffle(pool, seed + poolSeed).slice(0, count);
  }
  for (const [aspect, count] of majorKeys.map((key, i) => [key, evenSplit(majorTotal, majorKeys.length)[i]])) {
    for (const [bodyA, bodyB] of nextFromPool(count)) pairs.push({ category, aspect, bodyA, bodyB });
  }
  for (const [aspect, count] of minorKeys.map((key, i) => [key, evenSplit(minorTotal, minorKeys.length)[i]])) {
    for (const [bodyA, bodyB] of nextFromPool(count)) pairs.push({ category, aspect, bodyA, bodyB });
  }
  return pairs;
}

/** Plain seeded sample for any other category — those spaces are small/uniform enough already. */
function sampleUniform(placements, sampleSize, seed) {
  return seededShuffle(placements, seed).slice(0, sampleSize);
}

function sampleForCategory(category, sampleSize, seed) {
  const isAspectShaped = category === 'aspect-pair' || category === 'synastry-aspect';
  if (isAspectShaped) return sampleAspectPairs(category, sampleSize, seed);
  const pool = buildPlacements().filter((p) => p.category === category);
  if (pool.length === 0) throw new Error(`unknown or empty category "${category}"`);
  return sampleUniform(pool, sampleSize, seed);
}

const rawArgs = process.argv.slice(2);
function flag(name, fallback) {
  const found = rawArgs.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(
    'Usage: npx tsx --env-file=.env.local tools/corpus-gen/sample-validate-batch.mjs --category=synastry-aspect [--locale=nl] [--sample-size=18] [--provider=ollama|gemini] [--judge-provider=gemini|ollama] [--seed=N] [--out=FILE]',
  );
  process.exit(0);
}

const category = flag('category');
if (!category) throw new Error('--category=<corpus category> is required, e.g. --category=synastry-aspect');
const locale = flag('locale', 'nl');
if (locale !== 'en' && locale !== 'nl') throw new Error('--locale must be "en" or "nl"');
const sampleSize = Number(flag('sample-size', '18'));
const seed = Number(flag('seed', '368'));
const outPath = flag('out');

const PROVIDERS = ['gemini', 'ollama'];
const provider = flag('provider', 'ollama');
if (!PROVIDERS.includes(provider))
  throw new Error(`--provider must be one of ${PROVIDERS.join(', ')}, got "${provider}"`);
const judgeProvider = flag('judge-provider', 'gemini');
if (!PROVIDERS.includes(judgeProvider))
  throw new Error(`--judge-provider must be one of ${PROVIDERS.join(', ')}, got "${judgeProvider}"`);
if (judgeProvider === provider && !rawArgs.includes('--allow-same-provider-judge')) {
  throw new Error(
    `--judge-provider (${judgeProvider}) is the same as --provider (${provider}) — a same-model judge grading its ` +
      `own generation defeats the point of an independent fact-grounding check. Pass ` +
      `--allow-same-provider-judge to override.`,
  );
}

function libFor(p) {
  return p === 'ollama' ? './lib/ollama.mjs' : './lib/gemini.mjs';
}
function modelFor(p) {
  if (p === 'ollama') return process.env.OLLAMA_MODEL || 'gemma4';
  return process.env.GEMINI_MODEL;
}
function baseUrlFor(p) {
  if (p === 'ollama') return process.env.OLLAMA_BASE_URL;
  return process.env.GEMINI_BASE_URL;
}
function apiKeyFor(p) {
  if (p === 'gemini') return process.env.GEMINI_API_KEY;
  return undefined;
}

const { generateStructured: generate } = await import(libFor(provider));
const { generateStructured: judge } =
  judgeProvider === provider ? { generateStructured: generate } : await import(libFor(judgeProvider));
const model = modelFor(provider);
const judgeModel = modelFor(judgeProvider);
const baseUrl = baseUrlFor(provider);
const judgeBaseUrl = baseUrlFor(judgeProvider);

const corpusPath = join(root, 'src', 'interpretation', 'corpus', `${locale}.json`);
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));
const symbolismContext = buildSymbolismContext(locale);

const placements = sampleForCategory(category, sampleSize, seed);

const lines = [];
function log(line = '') {
  lines.push(line);
  console.log(line);
}

log(`#368 sample-validate: category=${category} locale=${locale} sample-size=${String(placements.length)}`);
log(`generator: ${provider} (model: ${String(model)})   judge: ${judgeProvider} (model: ${String(judgeModel)})`);
log(
  `note: this category is sampled because it's Ollama's long-tail/bulk assignment (combinatorial ` +
    `volume, not lower priority) — a low clean rate here says something about the model, not about ` +
    `how much this content matters.`,
);
log();

let generatorUsageIn = 0;
let generatorUsageOut = 0;
let judgeUsageIn = 0;
let judgeUsageOut = 0;

const results = [];
for (const placement of placements) {
  const description = placementDescription(placement);
  const label = description;
  const row = { placement, label };

  let generated;
  try {
    const systemInstruction = buildSystemInstruction({
      symbolismContext,
      locale,
      forceLanguageDirective: provider === 'ollama',
    });
    const userContent = buildUserContent({ placementDescription: description, corpusEntries: corpus, locale });
    generated = await generate({
      apiKey: apiKeyFor(provider),
      model,
      baseUrl,
      temperature: 0.3,
      systemInstruction,
      userContent,
      responseSchema: CORPUS_ENTRY_RESPONSE_SCHEMA,
      maxRetries: 2,
      onUsage: (usage) => {
        generatorUsageIn += usage?.promptTokenCount ?? 0;
        generatorUsageOut += (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
      },
    });
  } catch (error) {
    row.generationError = error.message;
    results.push(row);
    log(`[GEN-ERROR] ${label}: ${error.message}`);
    continue;
  }

  const entry = { key: 'sample', locale, text: generated.text, tier: generated.tier, tags: [] };
  row.text = generated.text;
  row.len = generated.text.length;
  row.lintIssues = lintEntry(entry);

  try {
    const { systemInstruction, userContent } = buildVerificationPrompt({
      factsDescription: factsDescription(placement),
      entryText: generated.text,
      locale,
    });
    const judged = await judge({
      apiKey: apiKeyFor(judgeProvider),
      model: judgeModel,
      baseUrl: judgeBaseUrl,
      temperature: 0,
      systemInstruction,
      userContent,
      responseSchema: VERIFICATION_RESPONSE_SCHEMA,
      maxRetries: 3,
      onUsage: (usage) => {
        judgeUsageIn += usage?.promptTokenCount ?? 0;
        judgeUsageOut += (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
      },
    });
    row.grounded = judged.grounded;
    row.groundingIssues = judged.issues;
  } catch (error) {
    row.groundingError = error.message;
  }

  results.push(row);
  const clean = row.lintIssues.length === 0 && row.grounded === true;
  const status = clean ? 'OK  ' : row.groundingError ? 'JERR' : 'FAIL';
  log(`[${status}] ${label} (len=${String(row.len)})`);
  log(`         ${row.text}`);
  if (row.lintIssues.length) log(`         lint: ${row.lintIssues.map((i) => i.rule).join(', ')}`);
  if (row.grounded === false) log(`         grounding: ${row.groundingIssues.join(' / ')}`);
  if (row.groundingError)
    log(`         grounding check failed (generation still counted below): ${row.groundingError}`);
}

const total = results.length;
const generationErrors = results.filter((r) => r.generationError).length;
const judgeErrors = results.filter((r) => r.groundingError).length;
const lintFailed = results.filter((r) => !r.generationError && r.lintIssues?.length > 0).length;
const ungrounded = results.filter((r) => !r.generationError && r.grounded === false).length;
const clean = results.filter((r) => !r.generationError && r.lintIssues?.length === 0 && r.grounded === true).length;
const cleanRate = total > 0 ? clean / total : 0;

log();
log(
  `${String(clean)}/${String(total)} fully clean (${(cleanRate * 100).toFixed(0)}%) — ` +
    `${String(lintFailed)} lint-failed, ${String(ungrounded)} ungrounded, ` +
    `${String(generationErrors)} generation errors, ${String(judgeErrors)} judge errors`,
);
{
  const generatorCostCents = estimateCostCentsForCall({
    provider,
    model,
    promptTokens: generatorUsageIn,
    outputTokens: generatorUsageOut,
  });
  const judgeCostCents = estimateCostCentsForCall({
    provider: judgeProvider,
    model: judgeModel,
    promptTokens: judgeUsageIn,
    outputTokens: judgeUsageOut,
  });
  const costLine = (label, costCents, m) =>
    costCents === undefined ? `${label}: cost unknown (no pricing on file for ${m})` : `${label}: ${formatCents(costCents)}`;
  log(`est. cost — ${costLine('generator', generatorCostCents, model)}, ${costLine('judge', judgeCostCents, judgeModel)}`);
}
log();
log('PROPOSED NEXT STEPS');
if (generationErrors === total) {
  log(
    `Every sample failed to generate at all — this is a connectivity/config problem (missing key, ` +
      `wrong model name, Ollama not running), not a content-quality finding. Fix that before drawing ` +
      `any conclusion about ${String(model)}.`,
  );
} else if (cleanRate >= 0.9) {
  log(
    `${String(model)} looks reliable for "${category}" (${(cleanRate * 100).toFixed(0)}% clean on ` +
      `this sample). Recommend proceeding with a full regeneration of this category using ` +
      `--provider=${provider}, then re-running this same tool as a post-regeneration spot-check.`,
  );
} else if (cleanRate >= 0.5) {
  const issueKinds = new Set([
    ...results.flatMap((r) => r.lintIssues?.map((i) => i.rule) ?? []),
    ...results.filter((r) => r.grounded === false).flatMap(() => ['fact-grounding']),
  ]);
  log(
    `${String(model)} is inconsistent for "${category}" (${(cleanRate * 100).toFixed(0)}% clean). ` +
      `Recurring issue kinds seen: ${[...issueKinds].join(', ') || 'none categorized'}. Recommend a ` +
      `larger sample (--sample-size=${String(sampleSize * 3)}) before deciding whether to regenerate ` +
      `or switch models.`,
  );
} else {
  const alternateHint =
    provider === 'ollama' && model === 'gemma4'
      ? `Consider validating a comparison sample against a different local model, e.g.:\n` +
        `  OLLAMA_MODEL=<some-other-model> npx tsx --env-file=.env.local tools/corpus-gen/sample-validate-batch.mjs ` +
        `--category=${category} --locale=${locale}`
      : `Consider generating and validating a comparison sample with gemma4 (the current default), e.g.:\n` +
        `  npx tsx --env-file=.env.local tools/corpus-gen/sample-validate-batch.mjs ` +
        `--category=${category} --locale=${locale}`;
  log(
    `${String(model)} is not reliable enough for "${category}" (${(cleanRate * 100).toFixed(0)}% clean). ` +
      `Recommend against using --provider=${provider} --provider-model=${String(model)} for this category. ` +
      `${alternateHint}\n` +
      `before deciding whether to regenerate this category at all.`,
  );
}

const report = lines.join('\n');
if (outPath) {
  await writeFile(resolve(outPath), `${report}\n`);
  console.log(`\nWrote report to ${outPath}`);
}
