# Benchmarking Astraya's interpretation text against astrologyapi.com

`verify-batch.mjs` and `classical-triage-batch.mjs` (#359) check the shipped
corpus against Astraya's own computed facts and against a classical source.
Neither answers a more basic question: **is Astraya's generated
interpretation text actually good**, compared to what an established
astrology service already produces for the same placement? #368 is that
comparison: fetch astrologyapi.com's own prose for a real placement,
compare it against Astraya's text for the exact same placement, and score
both with three independent local judges —
[Laya](https://github.com/receptron/laya), `all-minilm` (an embedding
model, via Ollama), and `gemma4` (a generative LLM, also via Ollama) — see
[`LAYA_INTERPRETATION_COMPARISON.md`](./LAYA_INTERPRETATION_COMPARISON.md)
for what Laya actually is, its own mechanics/token-budget details, and why
none of these three should be trusted blindly on a domain (astrology prose)
none of them were built for.

Like every other `tools/corpus-gen/` script, this is dev-time/offline
tooling. `src/` never holds astrologyapi.com's or Laya's credentials, never
calls either at runtime — unaffected by this work (`test/no-runtime-llm-access.test.ts`,
`server/csp.ts`'s `connect-src 'self'`).

## Scope

Only 4 of the corpus's 9 categories have a matching astrologyapi.com prose
endpoint:

| corpus category   | astrologyapi.com endpoint                |
| ----------------- | ---------------------------------------- |
| `planet-in-sign`  | `general_sign_report/tropical/{planet}`  |
| `planet-in-house` | `general_house_report/tropical/{planet}` |
| `sign-on-cusp`    | `natal_house_cusp_report`                |
| `aspect-pair`     | `natal_aspects_report`                   |

`dignity-state`, `nakshatra`, `pattern`, `synastry-aspect`, `transit-aspect`
have no third-party prose endpoint and are out of scope. Bodies are
restricted to the 7 traditional planets (Sun through Saturn) —
astrologyapi.com is a Vedic-oriented vendor and outer planets/nodes/Lilith/
asteroids aren't confirmed supported on these specific report endpoints.

astrologyapi.com's report endpoints take a real birth chart, not an
arbitrary placement — there's no way to ask it for "Sun in Leo" directly,
only "Sun's sign report for this chart" (whatever sign that turns out to
be). So this samples from a small, fixed pool of real charts
(`lib/benchmark-charts.mjs`): each chart's real positions/houses come from
astrologyapi.com's own `planets/tropical` and `house_cusps/tropical` calls
(not Astraya's ephemeris engine, which can't run outside Vite/Vitest — see
that file's own doc comment for why), and Astraya's pure
`signIndex`/`houseOf`/`findAspects` math derives the real placements each
chart actually contains. This guarantees the astrologyapi.com report call
and Astraya's text always describe the exact same placement.

`western_horoscope` — the single combined call this used originally — is
**currently broken on astrologyapi.com's own server** (confirmed against a
real account, 2026-09-30: every call returns HTTP 200 with an internal
Lambda crash as the body, the same failure this project's own astrology MCP
tool integration hit independently). `planets/tropical` +
`house_cusps/tropical` return the same underlying data without going
through that broken code path — see `lib/benchmark-charts.mjs`'s own doc
comment if `western_horoscope` ever gets fixed server-side and switching
back becomes worth it.

## What gets judged

Three independent judges score every scored placement — Laya, `all-minilm`,
and `gemma4` — so the three can be cross-checked against each other rather
than trusting a single model's calibration on a domain none of them were
built for. Early real runs found exactly the failure mode that justifies
this: Laya's own `grounded` scores came out implausibly low for text that
visibly matched its placement.

### Laya

Four calls per scored placement, not one — "which text is right" and "do
the two texts actually agree with each other" are different questions:

- **`grounded`** (asked once per text) — is this text consistent with the
  placement's own computed facts? Answered independently for Astraya's text
  and for astrologyapi.com's, each against just that one text plus the
  (short) facts string, to stay inside Laya's real ~300–320 token `state`
  budget (see `LAYA_INTERPRETATION_COMPARISON.md`).
- **`preference`** — given both texts, which one better matches the facts?
- **`similarity`** — do the two texts express essentially the same core
  meaning, regardless of which one is "more right"? Scored on an ordered
  rubric (`Not similar` / `Slightly similar` / `Highly similar` /
  `Identical`). `preference` and `similarity` share one call since both
  inherently need both texts in `state` together — that call keeps the
  already-flagged truncation risk the split `grounded` calls avoid.

### `all-minilm`

Cosine similarity over embeddings (local, via Ollama's `/api/embed`) — a
better-established tool for plain text-vs-text similarity than Laya, which
was trained for ticket/email-style classification, not validated on
astrology prose. Two things computed from three embeddings per placement
(facts, Astraya's text, third-party text):

- **`similarity`** — Astraya's text vs. the third-party text.
- **`grounded`** (per side) — that text vs. the facts string itself, the
  embedding analogue of Laya's own `grounded` question.

`LAYA_INTERPRETATION_COMPARISON.md` flagged checking whether Laya and an
embedding model agree as a "still open" item; the dashboard's pairwise
"agreement (r)" stats are that check, computed automatically over every
accumulated result.

### `gemma4`

A generative LLM (local, via Ollama, temperature 0 for determinism), asked
directly for the same `grounded`/`similarity` judgments in one structured
JSON call with both texts and the facts already in its context — no
300-token budget to work around, so no truncation risk the way Laya has.
`LAYA_INTERPRETATION_COMPARISON.md`'s own prior research reasoned through
exactly this fallback ("only reach for a generative Ollama LLM judge ... if
a spike shows Laya's calibration genuinely doesn't hold up") and concluded
it wasn't warranted yet; early real runs of this benchmark turned up
exactly that trigger.

All three judges are independently non-fatal: a machine without Ollama
running, or missing a pulled model, still gets whichever judges _are_
available for a given placement — the empty ones just show `—` in the
dashboard.

## Setup

```
cp .env.example .env.local
```

Required:

```
ASTROLOGYAPI_API_KEY=<your key>   # https://astrologyapi.com — free tier, no card required
```

Optional, only used when a sampled placement has no shipped `en.json` entry
yet (rare — the neutral corpus is well populated) and falls back to
generating one on demand:

```
GEMINI_API_KEY=<your key>   # or --provider=ollama, see OLLAMA_CORPUS_GENERATION.md
```

For the `all-minilm` and `gemma4` judges (both optional — skipped, not
fatal, if unset):

```
ollama pull all-minilm
ollama pull gemma4
```

```
OLLAMA_EMBED_MODEL=       # leave empty for the default (all-minilm)
OLLAMA_LLM_MODEL=         # leave empty for the default (gemma4)
OLLAMA_BASE_URL=          # leave empty for the default local endpoint, same variable OLLAMA_CORPUS_GENERATION.md documents
```

## Running a batch

```
npx tsx --env-file=.env.local tools/corpus-gen/benchmark-batch.mjs [--sample-size=N] [--limit=N] [--provider=gemini|ollama] [--force] [--out=FILE]
```

- `--sample-size` (default 3) — placements sampled per in-scope category.
- `--limit` — total cap across all categories.
- `--provider` (default `gemini`) — which model backs on-demand generation
  when a sampled placement isn't already shipped.
- `--force` — re-check placements that already have a result, overwriting
  it. Without this flag, anything already verified is skipped.
- `--out=FILE` — also write the console report to a file.
- `--purge-thirdparty-cache` — deletes the temporary third-party response
  cache (see below) and exits; does not run a batch.

A first run against a small sample, before trusting a bigger one, costs
only a few cents (astrologyapi.com's own per-call pricing, checked against
its account dashboard, is $0.0025–$0.0050/call):

```
npx tsx --env-file=.env.local tools/corpus-gen/benchmark-batch.mjs --sample-size=1 --limit=4 --out=/tmp/368-benchmark.txt
```

### Caching: why a re-run doesn't just re-check everything

Every result is persisted to a local sqlite database
(`tools/corpus-gen/.data/benchmark.sqlite`, gitignored — a per-machine dev
cache, not something the repo distributes). A placement that already has a
**scored** result (Laya actually ran, not merely attempted) is skipped on
the next run — no repeat astrologyapi.com/Laya spend on something already
checked. Since the fixed chart pool's placement space is small and finite,
repeated runs incrementally cover more of it instead of re-paying for the
same placement every time.

A **skipped** result (the astrologyapi.com call failed, or its response
shape couldn't be confidently parsed — see "Known risk" below) is _not_
treated as verified, and stays eligible for a plain re-run with no flag
needed; only `--force` re-checks an already-_scored_ placement.

## What's persisted, and what never is

`benchmark_results` — the durable, dashboard-facing table — **never** holds
astrologyapi.com's fetched prose, in the console report or in storage. Only
these are kept there: the placement's own computed facts, Astraya's own
text (ours to keep, plus which model produced it), and the judges'
scores/verdicts. Check `tools/corpus-gen/lib/benchmark-db.mjs`'s schema
directly if you want to confirm this yourself — there is no column for it
in that table.

### The temporary third-party response cache

A second table, `thirdparty_cache`, is a deliberate, scoped exception to
that rule, added on explicit request: while actively iterating on the
judges (tuning thresholds, adding `all-minilm`/`gemma4`, fixing an
extraction heuristic), re-fetching the same placement's astrologyapi.com
report on every run wastes real money and rate-limit budget for nothing.
`fetchThirdPartyText()` checks this cache before making a real call, and
caches both the raw response and the extracted text after one. It:

- Backs `benchmark-dashboard.mjs`'s own per-row detail view (see below) —
  a second, later, equally explicit exception made on request, so both
  texts can actually be read side by side rather than only trusted as a
  score. Never feeds the console report or `--out`, and never becomes a
  column on `benchmark_results` itself.
- Lives in the same gitignored `tools/corpus-gen/.data/` directory as
  everything else here — never committed, never distributed, never
  reachable by an actual Astraya end user (the harm #368's own
  no-redistribution constraint was written to prevent).
- Is explicitly **temporary**. Once the judges are "solved and grounded" —
  thresholds settled, extraction heuristics confirmed correct, the
  `all-minilm`/`gemma4` cross-checks validated — delete it:

```
npx tsx --env-file=.env.local tools/corpus-gen/benchmark-batch.mjs --purge-thirdparty-cache
```

This only clears `thirdparty_cache`; `benchmark_results` (your accumulated
scores/history) is untouched. A cache hit whose extraction previously
failed is automatically re-parsed with the _current_ extractor on the next
run (no new network call) rather than replaying the same failure forever —
useful if you've just fixed a heuristic in `fetchThirdPartyText()`.

## Viewing results: the dashboard

```
npx tsx tools/corpus-gen/benchmark-dashboard.mjs [--out=FILE]
```

Reads the results database and writes one self-contained static HTML file
(`tools/corpus-gen/.data/benchmark-dashboard.html` by default) — no network
call, no API key, safe and free to regenerate any time. Open it directly in
a browser. It shows:

- Summary tiles: total checked/scored/skipped, good/bad counts, mean
  similarity per judge, every pairwise agreement (Pearson `r` between
  Laya/`all-minilm`/`gemma4` — the `LAYA_INTERPRETATION_COMPARISON.md`
  "still open" cross-check, computed automatically over every accumulated
  result), then mean grounded score per side and preference win rate as
  secondary context.
- A per-category bar comparison of Astraya's vs. astrologyapi.com's mean
  grounded score (Laya's — the one every scored row always has).
- A full, sortable, filterable table of every result: similarity columns
  for all three judges, then `grounded` for Astraya and for the third-party
  text, each again for all three judges, then `preference` (Laya-only —
  no embedding/LLM equivalent for "which text is more right") and which
  model produced Astraya's text. Every similarity/grounded value carries a
  small red → orange → yellow → green → bright-green dot (not similar/
  ungrounded → very similar/well grounded) beside it. **Click any row** to
  expand a detail panel with both Astraya's and astrologyapi.com's actual
  text, side by side — pulled from the temporary third-party cache (see
  above); if that cache has been purged, or the placement was skipped
  before a report was ever fetched, the panel says so instead. The tag is
  decided by averaging whichever similarity judges ran for that row (not
  grounded/preference):
  - **good** — mean normalized similarity across the available judges is
    at least 0.5.
  - **bad** — mean normalized similarity is below 0.5.
  - **warning** — the judges that did run disagree sharply with each other
    (spread > 0.4) — worth a look at which one is right before trusting
    any of them.
  - **needs review** — the astrologyapi.com call failed, or its response
    couldn't be confidently parsed; there's no similarity judgment to make
    yet.

## Known risks

**Response-shape guessing.** `general_sign_report`/`general_house_report`'s
shapes were confirmed directly against a real account (a single string
report field); `planets/tropical`/`house_cusps/tropical` (the chart-pool
build) likewise. `natal_house_cusp_report`/`natal_aspects_report` were
initially guessed wrong — both return their array _directly_ as the
top-level response, not wrapped in an object — and that's now fixed and
confirmed against real responses too, but the extraction heuristics inside
`fetchThirdPartyText()` (`benchmark-batch.mjs`) still guess at _which_
array item matches a given house/aspect-pair, since astrologyapi.com's own
field names for that weren't documented anywhere this session could check.
If you see repeated **needs review** skips for `sign-on-cusp`/`aspect-pair`
on the dashboard, that heuristic needs adjusting — the cached raw response
(readable directly from `thirdparty_cache`, or via the dashboard's own
detail view once extraction succeeds at least once) is the place to look.

**No judge here is a validated instrument for astrology prose.** Laya was
trained for ticket/email-style classification; `all-minilm` for general
sentence similarity; `gemma4` for general chat/instruction-following. None
of the three were built or fine-tuned for this specific domain. Treat
disagreement between them (the dashboard's own **warning** tag, and its
pairwise agreement stats) as more informative than any single judge's
absolute number — and treat all three agreeing as a stronger signal than
any one of them alone.
