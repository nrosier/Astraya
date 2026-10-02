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
 *   npx tsx --env-file=.env.local tools/corpus-gen/generate-batch.mjs --locale=en [--persona=<id>] [--limit=N] [--concurrency=N] [--delay-ms=N] [--skip-final-checks] [--provider=gemini|ollama] [--force] [--max-language-retries=N] [--batch]
 *
 * `--max-language-retries` (default 4): a response that fails lint's own
 * `language-mismatch` rule (text in the wrong locale entirely) is re-requested
 * from the same model against the same prompt, rather than accepted or given
 * up on after one draw — qwen2.5:14b in particular only *sometimes* ignores
 * the locale directive in its system prompt, so another sample at the same
 * (non-zero) temperature has a real chance of landing in the right language.
 * A key still wrong after every retry counts as failed, same as any other bad
 * response, and leaves whatever was already at that key (if anything)
 * untouched.
 *
 * `--batch` (Gemini only — `--provider=ollama` has no batch equivalent) submits every pending
 * placement as one inline Gemini Batch API job instead of one HTTP call per placement, at
 * Google's own 50%-of-standard-rate batch pricing. `--concurrency`/`--delay-ms` are meaningless
 * under `--batch` (there is exactly one submission, not N parallel callers) and are ignored.
 * `--max-language-retries` still applies, just reshaped for an async job: each "retry" above is a
 * whole further batch round submitted for only the keys still wrong after the previous round, not
 * a same-request retry — Gemini rarely needs more than round 1 for this (see
 * lib/gemini-batch.mjs's own doc comment), so in practice this costs nothing extra. A batch round
 * can take anywhere from under a minute to Google's documented "usually well under 24 hours, up
 * to a 48-hour hard expiry" — this command blocks and polls for the whole wait, same as the
 * non-batch path blocks for its own (much shorter) wall-clock run.
 *
 * `--force` (#368) turns this from a gap-filler into a full regeneration:
 * every placement in scope is (re)generated, replacing its existing entry in
 * place (same array index — never appended as a duplicate of the same key).
 * Hand-written `anchor: true` entries are never touched by `--force`, even
 * though they're otherwise ordinary corpus entries — they're the "3
 * gold-standard fragments" reference examples, not something a batch run
 * should be able to overwrite with its own output.
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
import { buildBatchRequest, submitBatch, pollBatch, extractBatchResults } from './lib/gemini-batch.mjs';
import { writeCorpus } from './lib/write-corpus.mjs';
import { buildPlacements, placementDescription, buildSymbolismContext, symbolismScopeFor } from './lib/placements.mjs';
import {
  CORPUS_ENTRY_RESPONSE_SCHEMA,
  placementKey,
  NEUTRAL_ONLY_CATEGORIES,
} from '../../src/interpretation/schema.ts';
import { lintCorpus, lintEntry } from '../../src/interpretation/lint.ts';
import { findNearDuplicates } from '../../src/interpretation/dedupe.ts';
import { estimateCostCentsForCall, formatCents } from './lib/cost-estimate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

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
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(
    'Usage: npx tsx --env-file=.env.local tools/corpus-gen/generate-batch.mjs --locale=en [--persona=<id>] [--limit=N] [--concurrency=N] [--delay-ms=N] [--skip-final-checks] [--provider=gemini|ollama] [--force] [--max-language-retries=N] [--batch]',
  );
  process.exit(0);
}
const locale = flag('locale');
if (locale !== 'en' && locale !== 'nl') throw new Error('--locale=en|nl is required');
const limit = Number(flag('limit', Infinity));
const concurrency = Number(flag('concurrency', '3'));
const delayMs = Number(flag('delay-ms', '200'));
const skipFinalChecks = rawArgs.includes('--skip-final-checks');
const force = rawArgs.includes('--force');
const MAX_LANGUAGE_RETRIES = Number(flag('max-language-retries', '4'));
const useBatch = rawArgs.includes('--batch');

const provider = flag('provider', 'gemini');
if (provider !== 'gemini' && provider !== 'ollama')
  throw new Error(`--provider must be "gemini" or "ollama", got "${provider}"`);
if (useBatch && provider !== 'gemini') {
  throw new Error("--batch requires --provider=gemini — Gemini's Batch API has no Ollama equivalent");
}
const { generateStructured } = await import(provider === 'ollama' ? './lib/ollama.mjs' : './lib/gemini.mjs');
const model = provider === 'ollama' ? process.env.OLLAMA_MODEL || 'gemma4' : process.env.GEMINI_MODEL;
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
// buildAnchorsBlock() (lib/prompt.mjs) originally required at least one hand-written `anchor:
// true` entry per locale to few-shot every prompt against — #56's "3 gold-standard fragments".
// Now optional (#368): anchors are used when present, but a from-scratch corpus (none) or a
// model judged capable of reasoning to the house style without an example (the user's own call
// for a full qwen2.5:14b regeneration) proceeds with no anchors and no seed file needed.
// `--seed-anchors-from=<path>` still works if you *want* to prime a from-scratch corpus with
// existing hand-written examples (a backup, or a git-restored copy) rather than going anchor-free.
const seedAnchorsFrom = flag('seed-anchors-from');
if (seedAnchorsFrom && corpus.filter((e) => e.anchor === true && e.locale === locale).length === 0) {
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
if (corpus.filter((e) => e.anchor === true && e.locale === locale).length === 0) {
  console.log(`[${locale}/${scopeLabel}] no anchor entries for this locale — generating with no few-shot example.`);
}

// Maps a (persona-scoped) key to its position in `corpus`, so a `--force` regeneration replaces
// the entry in place instead of pushing a second entry with the same key.
const existingIndex = new Map();
corpus.forEach((entry, i) => {
  if (entry.persona === persona?.id) existingIndex.set(entry.key, i);
});

const allPlacements = buildPlacements();
const pending = allPlacements
  .map((placement) => ({ placement, key: placementKey(placement) }))
  // profected-house/astro-line (#369) are neutral-only — no persona round should ever touch them,
  // same enforcement schema.ts's validateCorpusEntries applies to a shipped entry, just earlier
  // (skipped before spending a single API call, not caught only after generating one).
  .filter(({ placement }) => !persona || !NEUTRAL_ONLY_CATEGORIES.includes(placement.category))
  .filter(({ key }) => {
    const idx = existingIndex.get(key);
    if (idx === undefined) return true; // genuinely missing — always generate
    if (!force) return false; // already shipped, not forcing — gap-filler behavior
    return corpus[idx].anchor !== true; // forcing, but never regenerate a hand-written anchor
  })
  .slice(0, Number.isFinite(limit) ? limit : undefined);

console.log(
  `[${locale}/${scopeLabel}] provider: ${provider} (model: ${String(model)}) — restricted scope: ${String(allPlacements.length)} placements, ` +
    `${String(existingIndex.size)} already shipped, ${String(pending.length)} to ${force ? 'regenerate' : 'generate'}${force ? ' (--force)' : ''}`,
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

// Built per placement, not hoisted once: #379 made the symbolism half of this placement-scoped
// (only the relevant body/sign's symbolism, not every planet and sign on every request), so this
// now varies per item exactly like userContent already does.
function systemInstructionFor(placement) {
  return buildSystemInstruction({
    persona,
    symbolismContext: buildSymbolismContext(locale, symbolismScopeFor(placement)),
    locale,
    forceLanguageDirective: provider === 'ollama',
  });
}

function buildEntry({ key, placement, text, tier }) {
  return {
    key,
    locale,
    text,
    tier,
    tags: placement.category === 'dignity-state' ? [placement.state] : [],
    ...(persona ? { persona: persona.id } : {}),
    provenance: {
      source: 'generated',
      model,
      generatedAt: new Date().toISOString().slice(0, 10),
    },
  };
}

/** Writes a successfully-generated entry into `corpus` in place (or appends it) and persists. */
async function acceptEntry(key, entry) {
  const existing = existingIndex.get(key);
  if (existing === undefined) {
    corpus.push(entry);
    existingIndex.set(key, corpus.length - 1);
  } else {
    corpus[existing] = entry;
  }
  await persist();
}

const startedAt = Date.now();

/**
 * Batch path for --batch: each round submits one inline Gemini Batch job for every item still
 * remaining (every item, on round 1), waits for it, and routes each result into either `corpus`
 * (good) or the next round's remaining set (language-mismatched, rounds left) or a logged failure
 * (language-mismatched, no rounds left — or any other per-item error the API itself reported).
 * Mirrors the non-batch path's own retry-until-correct-language loop, just reshaped so a "retry"
 * is a further batch round instead of a same-request retry — see this file's own header comment
 * on why that reshaping costs effectively nothing extra against Gemini in practice.
 */
async function runBatchRounds() {
  let remaining = pending;
  for (let round = 1; round <= MAX_LANGUAGE_RETRIES && remaining.length > 0; round += 1) {
    const requests = remaining.map(({ placement, key }) =>
      buildBatchRequest({
        key,
        systemInstruction: systemInstructionFor(placement),
        userContent: buildUserContent({
          placementDescription: placementDescription(placement),
          corpusEntries: corpus,
          locale,
          persona,
          aspectKey: placement.aspect,
        }),
        temperature: Number(process.env.GEMINI_TEMPERATURE ?? '0.75'),
        responseSchema: CORPUS_ENTRY_RESPONSE_SCHEMA,
      }),
    );

    console.log(
      `\n[${locale}/${scopeLabel}] batch round ${String(round)}/${String(MAX_LANGUAGE_RETRIES)}: submitting ${String(requests.length)} request${requests.length === 1 ? '' : 's'}...`,
    );
    const submitted = await submitBatch({
      apiKey: process.env.GEMINI_API_KEY,
      baseUrl,
      model,
      displayName: `astraya-corpus-${locale}-${scopeLabel}-round${String(round)}-${String(Date.now())}`,
      requests,
    });
    console.log(`[${locale}/${scopeLabel}] batch round ${String(round)}: ${submitted.name} — polling...`);

    let lastState;
    const finished = await pollBatch({
      apiKey: process.env.GEMINI_API_KEY,
      baseUrl,
      name: submitted.name,
      onPoll: (state) => {
        if (state !== lastState) {
          lastState = state;
          console.log(`[${locale}/${scopeLabel}] batch round ${String(round)}: ${String(state)}`);
        }
      },
    });

    const results = extractBatchResults(finished);
    const byKey = new Map(results.map((r) => [r.key, r]));
    const nextRemaining = [];

    for (const item of remaining) {
      const result = byKey.get(item.key);
      if (result === undefined) {
        failed += 1;
        console.error(`[${locale}/${scopeLabel}] FAILED ${item.key}: no result came back for this key`);
        continue;
      }
      if (result.usage) {
        usageIn += result.usage.promptTokenCount ?? 0;
        // Gemini bills thinking tokens as output, confirmed against a real response's own
        // usageMetadata (totalTokenCount = promptTokenCount + candidatesTokenCount + thoughtsTokenCount).
        usageOut += (result.usage.candidatesTokenCount ?? 0) + (result.usage.thoughtsTokenCount ?? 0);
      }
      if (result.error) {
        failed += 1;
        console.error(`[${locale}/${scopeLabel}] FAILED ${item.key}: ${result.error.message}`);
        continue;
      }

      const entry = buildEntry({
        key: item.key,
        placement: item.placement,
        text: result.result.text,
        tier: result.result.tier,
      });
      const languageIssue = lintEntry(entry).find((issue) => issue.rule === 'language-mismatch');
      if (languageIssue) {
        if (round < MAX_LANGUAGE_RETRIES) {
          nextRemaining.push(item);
        } else {
          failed += 1;
          console.error(
            `[${locale}/${scopeLabel}] FAILED ${item.key}: ${languageIssue.message} (still wrong after ${String(MAX_LANGUAGE_RETRIES)} rounds)`,
          );
        }
        continue;
      }

      await acceptEntry(item.key, entry);
      done += 1;
    }

    console.log(
      `[${locale}/${scopeLabel}] batch round ${String(round)} complete: ${String(done)} written so far, ${String(failed)} failed so far, ${String(nextRemaining.length)} going to the next round`,
    );
    remaining = nextRemaining;
  }
}

if (useBatch) {
  await runBatchRounds();
} else {
  await withConcurrency(pending, concurrency, async ({ placement, key }) => {
    const systemInstruction = systemInstructionFor(placement);
    const userContent = buildUserContent({
      placementDescription: placementDescription(placement),
      corpusEntries: corpus,
      locale,
      persona,
      aspectKey: placement.aspect,
    });

    try {
      let entry;
      let languageIssue;
      let attempt = 0;
      do {
        attempt += 1;
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
            usageOut += (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
          },
        });

        entry = buildEntry({ key, placement, text: result.text, tier: result.tier });

        languageIssue = lintEntry(entry).find((issue) => issue.rule === 'language-mismatch');
        if (languageIssue && attempt < MAX_LANGUAGE_RETRIES) {
          if (useProgressBar) process.stdout.write('\n');
          console.error(
            `[${locale}/${scopeLabel}] ${key}: attempt ${String(attempt)}/${String(MAX_LANGUAGE_RETRIES)} came back in the wrong language — regenerating`,
          );
        }
      } while (languageIssue && attempt < MAX_LANGUAGE_RETRIES);

      // Still wrong after every retry: caught below and counted as a failed key, same as any
      // other bad response. A single bad draw from a model that only *sometimes* ignores the
      // locale in its own system prompt (qwen2.5:14b, observed) would otherwise sail through
      // untouched, since none of this file's other checks are locale-aware.
      if (languageIssue)
        throw new Error(`${languageIssue.message} (still wrong after ${String(MAX_LANGUAGE_RETRIES)} attempts)`);

      await acceptEntry(key, entry);
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
}

console.log(`\n[${locale}/${scopeLabel}] batch complete: ${String(done)} written, ${String(failed)} failed`);

{
  const costCents = estimateCostCentsForCall({
    provider,
    model,
    tier: useBatch ? 'batch' : 'standard',
    promptTokens: usageIn,
    outputTokens: usageOut,
  });
  const costNote =
    costCents === undefined
      ? `cost unknown (no pricing on file for ${model})`
      : `est. cost at ${provider === 'ollama' ? 'local' : useBatch ? 'Batch-tier' : 'Standard-tier'} rates: ${formatCents(costCents)}`;
  console.log(
    `[${locale}/${scopeLabel}] usage: ${String(usageIn)} input tokens, ${String(usageOut)} output tokens — ${costNote}`,
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
