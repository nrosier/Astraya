/**
 * #368 Part 3 — benchmarks Astraya's own interpretation text against
 * astrologyapi.com's prose for the same real placement, judged by Laya
 * (`@receptron/laya`), following up on `pilot-benchmark-cost.mjs`'s
 * confirmed-working endpoint mapping:
 *
 *   planet-in-sign  -> general_sign_report/tropical/{planet}
 *   planet-in-house -> general_house_report/tropical/{planet}
 *   sign-on-cusp    -> natal_house_cusp_report
 *   aspect-pair     -> natal_aspects_report
 *
 * `dignity-state`/`nakshatra`/`pattern`/`synastry-aspect`/`transit-aspect`
 * have no third-party prose endpoint and stay out of scope.
 *
 * Three independent judges score every scored placement, not one — each
 * answers "is this text grounded in the facts" and "how similar are the two
 * texts", so the three can be cross-checked against each other rather than
 * blindly trusting a single model's calibration on a domain (astrology
 * prose) none of them were built for:
 *
 *   - **Laya** (`@receptron/laya`) — a calibrated, non-generative classifier.
 *     `grounded` (asked once per text, against just that text + the facts,
 *     to respect Laya's real ~300-320 token `state` budget — see
 *     docs/LAYA_INTERPRETATION_COMPARISON.md) and `preference`/`similarity`
 *     (one combined call, since both need both texts together anyway).
 *   - **`all-minilm`** (local, via Ollama's `/api/embed`) — cosine
 *     similarity between embeddings. `similarity` = astraya-text vs.
 *     third-party-text; `grounded` = each text vs. the facts string. A
 *     better-established tool for plain text-vs-text similarity than Laya,
 *     which was trained for ticket/email-style classification, not
 *     validated on astrology prose.
 *   - **`gemma4`** (local generative LLM, via Ollama, temperature 0) — asked
 *     directly, in one structured-JSON call with both texts and the facts
 *     in context, for the same `grounded`/`similarity` judgments. The
 *     fallback docs/LAYA_INTERPRETATION_COMPARISON.md already reasoned
 *     through ("only reach for a generative Ollama LLM ... if a spike shows
 *     Laya's calibration genuinely doesn't hold up") — early real runs
 *     turned up exactly that: implausibly low Laya `grounded` scores for
 *     text that visibly matched its placement.
 *
 * All three are non-fatal independently: a machine without Ollama running,
 * or missing a pulled model, still gets whichever judges *are* available.
 *
 * astrologyapi.com's report endpoints take a real birth chart, not an
 * arbitrary placement, so this samples from `lib/benchmark-charts.mjs`'s
 * fixed pool of real, already-computed charts rather than trying to
 * construct a chart for an arbitrary target placement — see that file's
 * doc comment. Astraya's own text is read from the already-shipped en
 * corpus where a neutral entry exists, or generated on demand otherwise;
 * either way, nothing is written back to the corpus — this is a read-only
 * quality signal, matching every other report-only script in this
 * directory (verify-batch.mjs, classical-triage-batch.mjs never rewrite
 * `text`; sample-validate-batch.mjs never writes to the shipped corpus at
 * all). The model that produced Astraya's text (the corpus entry's own
 * recorded provenance if shipped, or this run's own `--provider` model if
 * generated on demand) is tracked per result.
 *
 * Per #368's own "no redistribution" constraint, astrologyapi.com's prose is
 * never printed, written to --out, or held in `benchmark_results` — only
 * facts, Astraya's own text, and the judges' scores are. It *is* cached
 * temporarily in a separate `thirdparty_cache` table (`lib/benchmark-db.mjs`),
 * added on the user's own explicit request so iterating on the judges
 * doesn't re-pay for the same astrologyapi.com call every run — pass
 * `--purge-thirdparty-cache` to delete that cache once the judges are
 * settled. That same cache also now backs `benchmark-dashboard.mjs`'s own
 * per-row detail view (both texts, side by side, for a human to actually
 * read) — a second, later, equally explicit exception the user asked for.
 * See `lib/benchmark-db.mjs`'s own doc comment for the exact scope of both.
 *
 * Results persist to a local sqlite database (`lib/benchmark-db.mjs`) keyed
 * by placement key. A placement that already has a non-skipped row is
 * skipped on the next run — no repeat astrologyapi.com/Laya spend on
 * something already checked — unless `--force` is passed, which re-checks
 * and overwrites it. See `tools/corpus-gen/benchmark-dashboard.mjs` to view
 * accumulated results, and `docs/BENCHMARK_ASTROLOGYAPI.md` for the full
 * write-up.
 *
 *   npx tsx --env-file=.env.local tools/corpus-gen/benchmark-batch.mjs [--sample-size=N] [--limit=N] [--provider=gemini|ollama] [--force] [--out=FILE]
 *   npx tsx --env-file=.env.local tools/corpus-gen/benchmark-batch.mjs --purge-thirdparty-cache
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRealPlacements, astrologyApiBirthBody } from './lib/benchmark-charts.mjs';
import { buildSystemInstruction, buildUserContent } from './lib/prompt.mjs';
import { placementDescription, factsDescription, buildSymbolismContext } from './lib/placements.mjs';
import {
  openBenchmarkDb,
  getResult,
  upsertResult,
  getCachedThirdParty,
  cacheThirdParty,
  purgeThirdPartyCache,
} from './lib/benchmark-db.mjs';
import { embed, generateStructured as ollamaGenerateStructured } from './lib/ollama.mjs';
import { bodyByKey } from '../../src/astrology/bodies.ts';
import { CORPUS_ENTRY_RESPONSE_SCHEMA } from '../../src/interpretation/schema.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE_URL = 'https://json.astrologyapi.com/v1';
const IN_SCOPE_CATEGORIES = ['planet-in-sign', 'planet-in-house', 'sign-on-cusp', 'aspect-pair'];
const DB_PATH = join(root, 'tools', 'corpus-gen', '.data', 'benchmark.sqlite');

const rawArgs = process.argv.slice(2);
function flag(name, fallback) {
  const found = rawArgs.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(
    'Usage: npx tsx --env-file=.env.local tools/corpus-gen/benchmark-batch.mjs [--sample-size=N] [--limit=N] [--provider=gemini|ollama] [--force] [--out=FILE]\n' +
      '   or: npx tsx --env-file=.env.local tools/corpus-gen/benchmark-batch.mjs --purge-thirdparty-cache',
  );
  process.exit(0);
}

const sampleSize = Number(flag('sample-size', '3'));
const limit = Number(flag('limit', Infinity));
const outPath = flag('out');
const force = rawArgs.includes('--force');
const db = openBenchmarkDb(DB_PATH);

if (rawArgs.includes('--purge-thirdparty-cache')) {
  const purged = purgeThirdPartyCache(db);
  console.log(`purged ${String(purged)} cached astrologyapi.com response(s) from the temporary cache.`);
  db.close();
  process.exit(0);
}

// Always Ollama, independent of --provider: neither judge model has a Gemini equivalent in this
// project's tooling, and both are local-only cross-checks, not the primary generation path.
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || 'all-minilm';
const OLLAMA_LLM_MODEL = process.env.OLLAMA_LLM_MODEL || 'gemma4';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL;

const provider = flag('provider', 'gemini');
if (provider !== 'gemini' && provider !== 'ollama')
  throw new Error(`--provider must be "gemini" or "ollama", got "${provider}"`);
const { generateStructured } = await import(provider === 'ollama' ? './lib/ollama.mjs' : './lib/gemini.mjs');
const model = provider === 'ollama' ? process.env.OLLAMA_MODEL || 'gemma4' : process.env.GEMINI_MODEL;
const baseUrl = provider === 'ollama' ? process.env.OLLAMA_BASE_URL : process.env.GEMINI_BASE_URL;

const apiKey = process.env.ASTROLOGYAPI_API_KEY;
if (!apiKey) throw new Error('ASTROLOGYAPI_API_KEY is not set — check .env.local');

async function callAstrologyApi(path, body) {
  const response = await fetch(`${BASE_URL}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-astrologyapi-key': apiKey },
    body: JSON.stringify(body),
  });
  const rawText = await response.text();
  let json;
  try {
    json = JSON.parse(rawText);
  } catch {
    json = undefined;
  }
  return { status: response.status, ok: response.ok, json, rawText };
}

/** Best-effort prose extraction — astrologyapi.com's own field name for a single-report response
 * isn't pinned down here (this session never saw the pilot's captured bodies, only the user did),
 * so this checks the vendor's most common field names first, then falls back to the longest
 * string field found anywhere in the response. */
function extractReportText(json) {
  if (json === undefined || json === null || typeof json !== 'object') return undefined;
  if (typeof json.report === 'string') return json.report;
  if (typeof json.bot_response === 'string') return json.bot_response;
  const strings = Object.values(json).filter((v) => typeof v === 'string' && v.length > 0);
  if (strings.length === 0) return undefined;
  return strings.reduce((longest, s) => (s.length > longest.length ? s : longest));
}

/** Picks the one array item (if any) matching `matches` out of a report that may return one item
 * per house/aspect-pair, or may be a single monolithic block — falls back to the whole response
 * only when no array is found at all. Confirmed against a real account (2026-09-30):
 * `natal_house_cusp_report`/`natal_aspects_report` return the array *directly* as the top-level
 * response (`[{house, sign, degree, report}, ...]` / `[{aspecting_planet, aspected_planet, type,
 * report}, ...]`), not wrapped in an object — checked first, before looking for a nested array
 * property, since that's the confirmed real shape rather than a guess. Returns `undefined` (never
 * a guess) when an array exists but nothing in it matches, so the caller skips Laya scoring rather
 * than feed it the wrong item. */
function extractArrayItemText(json, matches) {
  if (json === undefined || json === null || typeof json !== 'object') return undefined;
  const array = Array.isArray(json) ? json : Object.values(json).find((v) => Array.isArray(v));
  if (!Array.isArray(array)) return extractReportText(json);
  const item = array.find(matches);
  return item === undefined ? undefined : extractReportText(item);
}

function itemMentionsHouse(item, houseNumber) {
  return item !== undefined && item !== null && typeof item === 'object' && Object.values(item).includes(houseNumber);
}

function itemMentionsBothBodies(item, nameA, nameB) {
  const text = JSON.stringify(item).toLowerCase();
  return text.includes(nameA.toLowerCase()) && text.includes(nameB.toLowerCase());
}

/** This category's astrologyapi.com endpoint/body and how to pull the placement's own text out of
 * whatever it returns — shared between a fresh fetch and a cache-hit re-extraction. */
function endpointFor(sample) {
  const birthBody = astrologyApiBirthBody(sample.chart);
  switch (sample.category) {
    case 'planet-in-sign':
      return { path: `general_sign_report/tropical/${sample.planetSlug}`, body: birthBody, extract: extractReportText };
    case 'planet-in-house':
      return {
        path: `general_house_report/tropical/${sample.planetSlug}`,
        body: { ...birthBody, house_type: 'placidus' },
        extract: extractReportText,
      };
    case 'sign-on-cusp':
      return {
        path: 'natal_house_cusp_report',
        body: { ...birthBody, house_type: 'placidus' },
        extract: (json) => extractArrayItemText(json, (item) => itemMentionsHouse(item, sample.houseNumber)),
      };
    case 'aspect-pair': {
      const nameA = bodyByKey(sample.bodyA)?.name ?? sample.bodyA;
      const nameB = bodyByKey(sample.bodyB)?.name ?? sample.bodyB;
      return {
        path: 'natal_aspects_report',
        body: birthBody,
        extract: (json) => extractArrayItemText(json, (item) => itemMentionsBothBodies(item, nameA, nameB)),
      };
    }
    default:
      throw new Error(`unreachable: unhandled category "${sample.category}"`);
  }
}

/** The one astrologyapi.com call + extraction for a sampled placement. Third-party text is kept
 * in memory (never returned alongside anything written to the report) except for the temporary,
 * explicitly-requested `thirdparty_cache` (see `lib/benchmark-db.mjs`'s doc comment) — checked
 * first so a re-run reuses a prior fetch instead of paying for it again. A cache hit with no
 * `extracted_text` (a prior extraction failure) re-parses the cached raw response with the
 * *current* extractor rather than replaying the same failure forever, since the heuristics here
 * are exactly the kind of thing expected to improve over the life of this cache. */
async function fetchThirdPartyText(sample) {
  const { path, body, extract } = endpointFor(sample);

  const cached = getCachedThirdParty(db, sample.key);
  if (cached) {
    if (cached.extracted_text) return { ok: true, text: cached.extracted_text };
    if (cached.raw_json) {
      const text = extract(JSON.parse(cached.raw_json));
      if (text) cacheThirdParty(db, sample.key, { rawJson: cached.raw_json, extractedText: text });
      return { ok: true, text };
    }
  }

  const result = await callAstrologyApi(path, body);
  if (!result.ok) return { ok: false, status: result.status };
  const text = extract(result.json);
  cacheThirdParty(db, sample.key, { rawJson: JSON.stringify(result.json ?? result.rawText), extractedText: text });
  return { ok: true, text };
}

const corpusPath = join(root, 'src', 'interpretation', 'corpus', 'en.json');
const corpus = JSON.parse(await readFile(corpusPath, 'utf8'));

/** Astraya's own text for a sampled placement — the already-shipped neutral entry if one exists,
 * otherwise generated on demand and never persisted (this tool is read-only, per #368's own "not
 * an automatic corpus edit" constraint). */
async function astrayaTextFor(sample) {
  const shipped = corpus.find((e) => e.key === sample.key && e.locale === 'en' && e.persona === undefined);
  if (shipped) return { text: shipped.text, source: 'shipped', model: shipped.provenance?.model };

  const description = placementDescription(sample.placement);
  const systemInstruction = buildSystemInstruction({
    persona: undefined,
    symbolismContext: buildSymbolismContext('en'),
    locale: 'en',
    forceLanguageDirective: provider === 'ollama',
  });
  const userContent = buildUserContent({
    placementDescription: description,
    corpusEntries: corpus,
    locale: 'en',
    persona: undefined,
  });
  const result = await generateStructured({
    apiKey: process.env.GEMINI_API_KEY,
    model,
    baseUrl,
    temperature: Number(process.env.GEMINI_TEMPERATURE ?? '0.75'),
    systemInstruction,
    userContent,
    responseSchema: CORPUS_ENTRY_RESPONSE_SCHEMA,
    maxRetries: 5,
  });
  return { text: result.text, source: 'generated-on-demand', model };
}

console.log(`provider: ${provider} (model: ${String(model)}) — building the fixed chart pool's real placements...`);
const allPlacements = await buildRealPlacements(apiKey);

const byCategory = new Map(IN_SCOPE_CATEGORIES.map((c) => [c, []]));
for (const p of allPlacements) byCategory.get(p.category)?.push(p);

/** A row only counts as "already verified" (and so gets skipped unless --force) when Laya
 * actually scored it — a previously-skipped placement (a failed astrologyapi.com call, or an
 * unrecognized response shape) stays eligible for a plain re-run, since "we don't know yet" isn't
 * the same claim as "checked". */
function alreadyVerified(key) {
  const existing = getResult(db, key);
  return existing !== undefined && existing.skipped === 0;
}

let sampled = [];
let alreadyVerifiedCount = 0;
for (const category of IN_SCOPE_CATEGORIES) {
  const candidates = byCategory.get(category) ?? [];
  const eligible = force ? candidates : candidates.filter((p) => !alreadyVerified(p.key));
  alreadyVerifiedCount += candidates.length - eligible.length;
  sampled.push(...eligible.slice(0, sampleSize));
}
sampled = sampled.slice(0, Number.isFinite(limit) ? limit : undefined);

console.log(
  `sampled ${String(sampled.length)} placement(s) across ${String(IN_SCOPE_CATEGORIES.length)} categories` +
    (force
      ? ' (--force: re-checking regardless of prior results)'
      : ` — ${String(alreadyVerifiedCount)} already verified, skipped`),
);
if (sampled.length === 0) {
  console.log(
    alreadyVerifiedCount > 0
      ? 'nothing to do — everything in scope is already verified. Pass --force to re-check.'
      : 'nothing to do.',
  );
  process.exit(0);
}

const { Laya } = await import('@receptron/laya');
console.log('loading Laya...');
const laya = await Laya.load();

const SIMILARITY_CRITERIA = ['Not similar', 'Slightly similar', 'Highly similar', 'Identical'];
/** Laya's real `state` budget is ~300-320 tokens, not the 512/8192 marketing figures (see
 * docs/LAYA_INTERPRETATION_COMPARISON.md) — packing both texts into one `state` risks silently
 * truncating one of them. `grounded` is asked once per text, each against just that one text plus
 * the (short) facts string, so neither call risks truncation. `preference`/`similarity` inherently
 * need both texts together and keep that already-flagged risk. */
const GROUNDED_QUESTION = {
  grounded: { type: 'noul', instructions: "Is this text consistent with the placement's computed facts?" },
};
const COMPARISON_QUESTIONS = {
  preference: {
    type: 'choice',
    instructions: "Which text better matches the placement's computed facts?",
    criteria: { astraya: "Astraya's text", thirdparty: "the third-party service's text" },
  },
  similarity: {
    type: 'score',
    instructions: 'Do these two astrological interpretations express essentially the same core meaning?',
    criteria: SIMILARITY_CRITERIA,
  },
};

/** Laya's `score` answer is a continuous 0..N-1 value, not just the nearest label — round to the
 * nearest criterion for a human-readable tag, keeping the raw score for the mean-over-time stat.
 * Reused for gemma4's own 0..3 similarity score too, for a directly comparable label. */
function nearestSimilarityLabel(score) {
  const index = Math.min(SIMILARITY_CRITERIA.length - 1, Math.max(0, Math.round(score)));
  return SIMILARITY_CRITERIA[index];
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** `all-minilm`'s judgments: `similarity` is astraya-text vs. third-party-text; `grounded` (for
 * each side) is that text vs. the facts string itself — the embedding analogue of Laya's own
 * `grounded` question, computed the same cosine-similarity way. One embedding per input (3 total),
 * reused across all three comparisons. Non-fatal: a machine without Ollama running, or without
 * `all-minilm` pulled, still gets Laya's and gemma4's scores for this placement. */
async function embeddingSignalsFor(facts, astrayaText, thirdPartyText) {
  try {
    const [factsVec, astrayaVec, thirdPartyVec] = await Promise.all([
      embed({ model: OLLAMA_EMBED_MODEL, baseUrl: OLLAMA_BASE_URL, input: facts }),
      embed({ model: OLLAMA_EMBED_MODEL, baseUrl: OLLAMA_BASE_URL, input: astrayaText }),
      embed({ model: OLLAMA_EMBED_MODEL, baseUrl: OLLAMA_BASE_URL, input: thirdPartyText }),
    ]);
    return {
      similarity: cosineSimilarity(astrayaVec, thirdPartyVec),
      groundedAstraya: cosineSimilarity(astrayaVec, factsVec),
      groundedThirdParty: cosineSimilarity(thirdPartyVec, factsVec),
    };
  } catch (error) {
    log(
      `${OLLAMA_EMBED_MODEL} judge failed (${error.message}) — continuing without it. Is Ollama running with "ollama pull ${OLLAMA_EMBED_MODEL}"?`,
    );
    return {};
  }
}

/** gemma4 asked directly, in one structured-JSON call with both texts and the facts already in
 * context — see this file's own doc comment for why a generative Ollama LLM judge is warranted
 * here (Laya's calibration risk, already observed as implausible in early real runs). Temperature
 * 0 for determinism, per this project's own structured-output guidance elsewhere
 * (lib/prompt.mjs's generation calls use a temperature *because* variety is wanted there; a judge
 * wants the opposite). */
const LLM_JUDGE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    grounded_astraya: { type: 'number' },
    grounded_thirdparty: { type: 'number' },
    similarity_score: { type: 'number' },
  },
  required: ['grounded_astraya', 'grounded_thirdparty', 'similarity_score'],
};

async function llmJudgeFor(facts, astrayaText, thirdPartyText) {
  const systemInstruction =
    "You are an impartial astrology fact-checker. You are given the computed facts for one astrological placement and two independently written interpretations of it. Score each text's groundedness against the stated facts on a 0 (contradicts or is unrelated to the facts) to 1 (fully consistent with the facts) scale, independently of each other — do not compare the two texts for this part. Then score how similar the two texts are to each other in core meaning, regardless of which is more accurate, on a 0 (not similar at all) to 3 (identical meaning) scale. Respond only with the requested JSON.";
  const userContent = [
    `PLACEMENT FACTS: ${facts}`,
    '',
    `TEXT A (Astraya):\n${astrayaText}`,
    '',
    `TEXT B (third-party):\n${thirdPartyText}`,
    '',
    'Return grounded_astraya (0-1), grounded_thirdparty (0-1), and similarity_score (0-3).',
  ].join('\n');

  try {
    const result = await ollamaGenerateStructured({
      model: OLLAMA_LLM_MODEL,
      baseUrl: OLLAMA_BASE_URL,
      temperature: 0,
      systemInstruction,
      userContent,
      responseSchema: LLM_JUDGE_RESPONSE_SCHEMA,
      maxRetries: 2,
    });
    return {
      groundedAstraya: result.grounded_astraya,
      groundedThirdParty: result.grounded_thirdparty,
      similarityScore: result.similarity_score,
      similarityLabel: nearestSimilarityLabel(result.similarity_score),
    };
  } catch (error) {
    log(
      `${OLLAMA_LLM_MODEL} judge failed (${error.message}) — continuing without it. Is Ollama running with "ollama pull ${OLLAMA_LLM_MODEL}"?`,
    );
    return {};
  }
}

const lines = [];
function log(line = '') {
  lines.push(line);
  console.log(line);
}

log('#368 benchmark: Astraya vs. astrologyapi.com, judged by Laya, all-minilm, and gemma4');
log(
  "Third-party prose is never printed or written below, per #368's no-redistribution constraint — " +
    "only facts, Astraya's own text, and the judges' scores are. It is cached temporarily on disk " +
    "(gitignored, never committed) so re-runs while iterating on the judges don't re-pay for the " +
    "same astrologyapi.com call — run with --purge-thirdparty-cache once that's no longer needed. " +
    "The cached text itself is readable in the dashboard's per-row detail view.",
);
log();

const results = [];
for (const sample of sampled) {
  const facts = factsDescription(sample.placement);
  log(`--- ${sample.key} (${sample.category}: ${facts}) ---`);

  const astraya = await astrayaTextFor(sample);
  log(`Astraya text (${astraya.source}${astraya.model ? `, ${astraya.model}` : ''}): ${astraya.text}`);

  const commonRow = {
    placementKey: sample.key,
    category: sample.category,
    facts,
    astrayaText: astraya.text,
    astrayaSource: astraya.source,
    astrayaModel: astraya.model,
    checkedAt: new Date().toISOString(),
  };

  const thirdParty = await fetchThirdPartyText(sample);
  if (!thirdParty.ok) {
    const skipReason = `astrologyapi.com call FAILED (status ${String(thirdParty.status)})`;
    log(`${skipReason} — skipping this placement.`);
    log();
    upsertResult(db, { ...commonRow, skipped: true, skipReason });
    results.push({ sample, astraya, skipped: true });
    continue;
  }
  if (!thirdParty.text) {
    const skipReason = "could not confidently extract a matching item from astrologyapi.com's response shape";
    log(`${skipReason} — skipping this placement.`);
    log();
    upsertResult(db, { ...commonRow, skipped: true, skipReason });
    results.push({ sample, astraya, skipped: true });
    continue;
  }

  const groundedAstraya = await laya.systemOne({ placement: facts, text: astraya.text }, GROUNDED_QUESTION);
  const groundedThirdParty = await laya.systemOne({ placement: facts, text: thirdParty.text }, GROUNDED_QUESTION);
  const comparison = await laya.systemOne(
    { placement: facts, astraya_text: astraya.text, thirdparty_text: thirdParty.text },
    COMPARISON_QUESTIONS,
  );
  const embeddingSignals = await embeddingSignalsFor(facts, astraya.text, thirdParty.text);
  const llmJudge = await llmJudgeFor(facts, astraya.text, thirdParty.text);

  // Deliberately namespaced per judge (Laya/embedding/llm) rather than one shared `grounded*`/
  // `similarity*` key — three judges answering the same question need three distinct fields, or
  // a careless merge silently overwrites one judge's number with another's.
  const answers = {
    groundedAstrayaLaya: groundedAstraya.answers.grounded.noul,
    groundedThirdpartyLaya: groundedThirdParty.answers.grounded.noul,
    groundedAstrayaEmbedding: embeddingSignals.groundedAstraya,
    groundedThirdpartyEmbedding: embeddingSignals.groundedThirdParty,
    groundedAstrayaLlm: llmJudge.groundedAstraya,
    groundedThirdpartyLlm: llmJudge.groundedThirdParty,
    preference: comparison.answers.preference.choice,
    preferenceAstrayaProb: comparison.answers.preference.probabilities.astraya,
    preferenceThirdpartyProb: comparison.answers.preference.probabilities.thirdparty,
    similarityScoreLaya: comparison.answers.similarity.score,
    similarityLabelLaya: nearestSimilarityLabel(comparison.answers.similarity.score),
    similarityEmbedding: embeddingSignals.similarity,
    similarityScoreLlm: llmJudge.similarityScore,
    similarityLabelLlm: llmJudge.similarityLabel,
  };

  log(
    `grounded (Laya)        — Astraya: ${answers.groundedAstrayaLaya.toFixed(4)}, third-party: ${answers.groundedThirdpartyLaya.toFixed(4)}`,
  );
  log(
    answers.groundedAstrayaEmbedding !== undefined
      ? `grounded (${OLLAMA_EMBED_MODEL}) — Astraya: ${answers.groundedAstrayaEmbedding.toFixed(4)}, third-party: ${answers.groundedThirdpartyEmbedding.toFixed(4)}`
      : `grounded (${OLLAMA_EMBED_MODEL}) — unavailable this run`,
  );
  log(
    answers.groundedAstrayaLlm !== undefined
      ? `grounded (${OLLAMA_LLM_MODEL})    — Astraya: ${answers.groundedAstrayaLlm.toFixed(4)}, third-party: ${answers.groundedThirdpartyLlm.toFixed(4)}`
      : `grounded (${OLLAMA_LLM_MODEL})    — unavailable this run`,
  );
  log(
    `similarity (Laya): ${answers.similarityLabelLaya} (score ${answers.similarityScoreLaya.toFixed(2)} of ${String(SIMILARITY_CRITERIA.length - 1)})`,
  );
  log(
    answers.similarityEmbedding !== undefined
      ? `similarity (${OLLAMA_EMBED_MODEL}, cosine): ${answers.similarityEmbedding.toFixed(4)}`
      : `similarity (${OLLAMA_EMBED_MODEL}): unavailable this run — see message above`,
  );
  log(
    answers.similarityScoreLlm !== undefined
      ? `similarity (${OLLAMA_LLM_MODEL}): ${answers.similarityLabelLlm} (score ${answers.similarityScoreLlm.toFixed(2)} of ${String(SIMILARITY_CRITERIA.length - 1)})`
      : `similarity (${OLLAMA_LLM_MODEL}): unavailable this run — see message above`,
  );
  log(
    `preference (Laya): ${answers.preference} ` +
      `(astraya=${answers.preferenceAstrayaProb.toFixed(4)}, thirdparty=${answers.preferenceThirdpartyProb.toFixed(4)})`,
  );
  log();

  upsertResult(db, {
    ...commonRow,
    groundedAstraya: answers.groundedAstrayaLaya,
    groundedThirdparty: answers.groundedThirdpartyLaya,
    groundedAstrayaEmbedding: answers.groundedAstrayaEmbedding,
    groundedThirdpartyEmbedding: answers.groundedThirdpartyEmbedding,
    preference: answers.preference,
    preferenceAstrayaProb: answers.preferenceAstrayaProb,
    preferenceThirdpartyProb: answers.preferenceThirdpartyProb,
    similarityScore: answers.similarityScoreLaya,
    similarityLabel: answers.similarityLabelLaya,
    embeddingSimilarity: answers.similarityEmbedding,
    embeddingModel: answers.similarityEmbedding !== undefined ? OLLAMA_EMBED_MODEL : undefined,
    groundedAstrayaLlm: answers.groundedAstrayaLlm,
    groundedThirdpartyLlm: answers.groundedThirdpartyLlm,
    similarityScoreLlm: answers.similarityScoreLlm,
    similarityLabelLlm: answers.similarityLabelLlm,
    llmModel: answers.similarityScoreLlm !== undefined ? OLLAMA_LLM_MODEL : undefined,
    skipped: false,
  });
  results.push({ sample, astraya, answers, skipped: false });
}

await laya.close();
db.close();

const scored = results.filter((r) => !r.skipped);
log('SUMMARY');
log(
  `${String(sampled.length)} sampled, ${String(scored.length)} scored, ${String(results.length - scored.length)} skipped`,
);
if (scored.length > 0) {
  const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;

  const meanSimilarityLaya = mean(scored.map((r) => r.answers.similarityScoreLaya));
  log(
    `mean similarity (Laya): ${nearestSimilarityLabel(meanSimilarityLaya)} (score ${meanSimilarityLaya.toFixed(2)} of ${String(SIMILARITY_CRITERIA.length - 1)})`,
  );

  const withEmbedding = scored.filter((r) => r.answers.similarityEmbedding !== undefined);
  log(
    withEmbedding.length > 0
      ? `mean similarity (${OLLAMA_EMBED_MODEL}): ${mean(withEmbedding.map((r) => r.answers.similarityEmbedding)).toFixed(4)} (${String(withEmbedding.length)}/${String(scored.length)})`
      : `mean similarity (${OLLAMA_EMBED_MODEL}): unavailable for every placement this run`,
  );

  const withLlm = scored.filter((r) => r.answers.similarityScoreLlm !== undefined);
  if (withLlm.length > 0) {
    const meanSimilarityLlm = mean(withLlm.map((r) => r.answers.similarityScoreLlm));
    log(
      `mean similarity (${OLLAMA_LLM_MODEL}): ${nearestSimilarityLabel(meanSimilarityLlm)} (score ${meanSimilarityLlm.toFixed(2)} of ${String(SIMILARITY_CRITERIA.length - 1)})`,
    );
  } else {
    log(`mean similarity (${OLLAMA_LLM_MODEL}): unavailable for every placement this run`);
  }

  const astrayaWins = scored.filter((r) => r.answers.preference === 'astraya').length;
  log(
    `preference win rate (Laya) — Astraya: ${astrayaWins}/${scored.length}, third-party: ${scored.length - astrayaWins}/${scored.length}`,
  );
}
log(`\nresults persisted to ${DB_PATH} — run "npx tsx tools/corpus-gen/benchmark-dashboard.mjs" to view them.`);

if (outPath) {
  await writeFile(resolve(outPath), `${lines.join('\n')}\n`);
  console.log(`\nWrote report to ${outPath}`);
}
