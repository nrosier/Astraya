# Generating corpus text locally with Ollama

Astraya's interpretation corpus (`src/interpretation/corpus/`) is normally
generated with Gemini (see `.env.example`'s Gemini section and
`tools/corpus-gen/generate-batch.mjs`). `--provider=ollama` (#359) is a
local, no-API-key alternative to that — useful for offline/dev generation,
or for anyone who'd rather not send prompts to a hosted model at all. It is
**not** used for the corpus that ships in production: a hosted deployment
has no local model to call, so the committed corpus stays Gemini-generated.

Like the Gemini path, this tooling lives entirely under `tools/corpus-gen/`
and runs on your own machine at build/dev time. `src/` never holds a
model-provider credential or calls a model provider at runtime — that
boundary is unaffected by which provider generated the committed text.

## 1. Install and run Ollama

Install from [ollama.com](https://ollama.com), then pull the model this
project has standardized on:

```
ollama pull gemma4
```

Originally standardized on Mistral 7B (Apache-2.0, no usage restriction,
unlike Llama's or Gemma's custom licenses), but #371 found Mistral
unreliable for non-English locales — it drifted to English mid-generation
and, even after adding a forced-language directive, produced uncontrolled
repetition and mistranslations. `gemma4` was validated as a clean
replacement (#368's `sample-validate-batch.mjs`, 26/26 clean on
`synastry-aspect`) and is now the default; Gemma's custom license is an
accepted tradeoff since nothing built with it ships — it only produces
corpus text that's reviewed before commit. Ollama runs a local
server on `http://localhost:11434` once installed; nothing else to start
manually — `ollama pull` and `ollama run` both start it if it isn't already
running.

## 2. Configure

Copy the example env file, if you haven't already, and check the Ollama
section:

```
cp .env.example .env.local
```

Relevant variables (see `.env.example` for the full annotated list):

```
OLLAMA_MODEL=gemma4
OLLAMA_BASE_URL=
OLLAMA_NUM_CTX=
```

- `OLLAMA_MODEL` — which local model to call. `gemma4` is already the
  default both here and in the script itself (`generate-batch.mjs` falls
  back to `gemma4` if this is unset), so you only need to change it if you
  pulled a different model.
- `OLLAMA_BASE_URL` — leave empty to use the default local endpoint
  (`http://localhost:11434`). Only set this if Ollama is reachable
  somewhere else (a remote box, a non-default port).
- `OLLAMA_NUM_CTX` — leave empty for the client's own default (4096
  tokens). Ollama's _own_ default context length is VRAM-tier-dependent
  (4k below 24GiB of VRAM) rather than fixed by the model, so this is set
  explicitly on every request instead of silently inheriting whatever the
  serving machine happens to pick. Raise it if a corpus-gen prompt is
  getting truncated — check `ollama ps`'s `CONTEXT` column to see what's
  actually allocated.

No API key: Ollama is a local server, not a hosted one.

## 3. Generate the corpus

Run once per locale — `--locale=en` and `--locale=nl` are independent and
can run concurrently in separate terminals:

```
npx tsx --env-file=.env.local tools/corpus-gen/generate-batch.mjs --locale=en --provider=ollama
npx tsx --env-file=.env.local tools/corpus-gen/generate-batch.mjs --locale=nl --provider=ollama
```

### What gets generated

**Neutral only, by default** — the persona-less text every reader sees
before choosing a voice, and the fallback a persona-specific lookup lands on
when its own entry doesn't exist yet. Pass `--persona=<id>` (an id from
`tools/corpus-gen/personas.json`: `traditionalist`, `big_sister`, `cynic`,
`mystic`, `pragmatist`) to generate that persona's voice instead — omit it
to keep the neutral default, which is almost certainly what you want for a
first run.

Coverage generated per locale (all computed placement types the app can
produce): `planet-in-sign`, `planet-in-house`, `aspect-pair`,
`synastry-aspect`, and `dignity-state` (restricted to the 7 bodies with a
defined traditional rulership — this one's a correctness constraint, not a
scope choice; there's no classical dignity to invent for a body that has
none).

### Resumable, and skips what's already shipped

The script is idempotent: it only generates keys the locale's corpus
**doesn't already have** (scoped to `(key, persona)` — a neutral entry and a
persona entry for the same key are tracked separately). Every successful
entry is written immediately, so an interrupted run can just be re-run.

This also means that, on a locale whose neutral corpus is already fully
generated (which `en` and `nl` both are, as of #56/#359), a plain run will
report something like `0 to generate` and exit immediately — that's
expected, not a bug. `generate-batch.mjs` has no `--force`/`--overwrite`
flag, so it cannot be used as-is to regenerate an Ollama alternative for a
key that already has Gemini-generated text; it's a gap-filler, not a
side-by-side comparison tool. If you specifically want to compare Ollama's
output against the shipped text for the same placements, ask for that
tooling separately — it doesn't exist yet.

### Output: where it's written

Directly into the committed corpus file for that locale:

```
src/interpretation/corpus/en.json
src/interpretation/corpus/nl.json
```

Written incrementally, one entry at a time, via `writeCorpus()`
(`tools/corpus-gen/lib/write-corpus.mjs`) — only the entries that actually
changed get rewritten; everything else in the file keeps its exact original
formatting.

## 4. Useful flags

All from `generate-batch.mjs`'s own usage comment:

```
--persona=<id>        generate one persona's voice instead of neutral (see above)
--limit=N              stop after N entries (useful for a quick smoke test)
--concurrency=N         parallel requests (default 3)
--delay-ms=N            delay between requests (default 200)
--skip-final-checks     skip the whole-locale lint/dedupe pass at the end
```

`--skip-final-checks` is worth using if you're about to run several
`--persona` rounds back-to-back: that pass is quadratic in the locale's
total entry count, so paying it after every round adds up for no benefit
until the last round.

## 5. Other Ollama-compatible tooling

Two other `tools/corpus-gen/` scripts also accept `--provider=ollama` as
the judge model, for checking the _already-shipped_ corpus rather than
generating new entries:

```
npx tsx --env-file=.env.local tools/corpus-gen/verify-batch.mjs --locale=en --provider=ollama
npx tsx --env-file=.env.local tools/corpus-gen/classical-triage-batch.mjs --provider=ollama
```

- `verify-batch.mjs` — fact-grounding: checks whether each shipped entry's
  text is consistent with its own placement's computed facts, and tags any
  mismatch with `unverified-flagged-by-judge`. Never rewrites `text`.
- `classical-triage-batch.mjs` — checks `dignity-state` entries against
  excerpts from William Lilly's _Christian Astrology_ (1647), tagging
  substantive divergence for human review. Also never rewrites `text`.

Both are additive/non-destructive triage signals for #292's human review
queue — they flag, they don't auto-correct.

A third script, `sample-validate-batch.mjs` (#368), is for _before_ running
a full `generate-batch.mjs` pass: it samples a representative slice of a
category, generates candidate text for each with the real production
prompt builder, and checks it against fact-grounding and corpus lint —
without writing anything. Useful for deciding whether a given
`OLLAMA_MODEL` is safe to regenerate a whole category with, the way #371's
investigation used it to validate `gemma4` against `synastry-aspect` before
Mistral's replacement:

```
npx tsx --env-file=.env.local tools/corpus-gen/sample-validate-batch.mjs --category=synastry-aspect
```
