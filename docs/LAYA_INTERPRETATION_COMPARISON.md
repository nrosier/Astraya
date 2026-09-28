# Comparing two interpretations locally with Laya/Jev

Background for #368 (benchmarking Astraya's Ollama-generated interpretation
text against a third-party astrology API) and for the local
two-interpretation comparison tool asked for separately: what Laya and Jev
actually are, and how to point either one at a pair of astrological
interpretations.

## Not text generators

Neither Jev nor Laya generates free-form text or performs traditional
generative summarization. They're **System-1 decision engines** —
non-autoregressive models built to evaluate a given context (the "state")
against typed questions, returning structured probabilities, a binary
decision, or a numerical score. That's the right shape for "are these two
interpretations saying the same thing, and how confident is that judgment,"
and the wrong shape for "write me a summary of the difference."

## Shape of a comparison call

Pass both interpretations together as the `state`, then ask one or more
typed questions about their relationship:

```
state = """
Interpretation A: The Sun in the 10th House indicates a strong drive for
career recognition, leadership roles, and public visibility.
Interpretation B: Having your Sun in the 10th House suggests that your life
path focuses heavily on ambition, professional status, and making a mark
on your community.
"""

questions = [
  {
    id: "is_similar",
    type: "noul",   // binary judgment — calibrated P(true), 0..1
    prompt: "Do these two astrological interpretations express essentially the same core meaning?",
  },
  {
    id: "similarity_score",
    type: "score",  // ranked/ordered rubric
    levels: ["Not similar", "Slightly similar", "Highly similar", "Identical"],
    prompt: "Rate the degree of semantic agreement between Interpretation A and Interpretation B.",
  },
]

response = client.evaluate({ state, questions })
```

That gives two independent signals for the "score + confidence" ask:
`similarity_score` (or its own `noul`) as the score itself, and the
`noul` probability's distance from 0.5 as a confidence measure — a P(true)
of 0.95 is a confident "yes," 0.55 is a shrug.

### Mapping to `@receptron/laya`'s actual TypeScript API

The pseudo-code above is generic; `@receptron/laya` (installed as a
devDependency, npm `0.1.2`) has a slightly different concrete shape worth
noting before building anything against it:

- Load once: `const laya = await Laya.load({ ... })` — weights (~1.7GB) cache
  to `~/.cache/receptron-laya` on first use.
- Ask: `await laya.systemOne(state, questions)` →
  `{ answers: Record<string, ChoiceAnswer | ScoreAnswer | NoulAnswer>, usage }`.
- Question `type` values are lower-case: `"choice"`, `"score"`, `"noul"` (not
  `"Choice"`/`"Score"`/`"Noul"`).
- The `score` type's rubric field is `criteria: string[]` (an ordered list of
  labels, low → high), not `levels` — same idea as the pseudo-code above,
  different field name. Its answer is `{ score: number, distribution: Record<string, number> }`
  (a continuous 0..N-1 value plus the full distribution, not just the top
  label).
- The `noul` type's answer is `{ noul: number }` — the calibrated P(true).

**Context window discrepancy — confirmed 2026-09-28, no longer open.** The
"up to 8,192 tokens" marketing claim is wrong for the pinned model. Fetched
`laya_config.json` directly from the installed package's configured source
(`receptron/laya-onnx` on Hugging Face — see `dist/download.js`'s
`DEFAULT_REPO`/`BUNDLE_FILES`) without needing the full ~1.7GB weight
download, since `max_len`/`head_max_len` live in that one small JSON file:

```json
{ "max_len": 512, "head_max_len": 192 }
```

Cross-checked against the installed package's actual packing logic
(`dist/sequence.js`'s `buildSequence`, doc comment `[CLS] <type> question:
instructions [SEP] [MASK] opt0 [MASK] opt1 ... [SEP] state [SEP]`): the
question header + options are capped at `head_max_len` (192 tokens), then
`state` gets whatever room is left out of `max_len` (512) —
`encode(state).slice(0, room)`, silently truncated, no error raised. In
practice that leaves **roughly 300-320 tokens for `state`**, not 512 and
nowhere near 8,192. Packing two full interpretation paragraphs into one
`state` (a head-to-head Choice call) will realistically truncate one of them
mid-paragraph; a single paragraph against a short facts string (the
fact-grounding framing) fits far more comfortably.

## Choosing between Jev and Laya

| Feature        | Jev                           | Laya                                                                                                               |
| -------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Type           | Proprietary API (TypeSafe AI) | Open-source / open-weights (Convai Innovations)                                                                    |
| Deployment     | Cloud-based API               | Local execution (Docker, PyTorch, Hugging Face, or this repo's `@receptron/laya` ONNX runtime)                     |
| Speed          | Sub-second API inference      | Very fast (~33 ms/query) once weights are loaded                                                                   |
| Context window | Medium/standard               | Up to ~8,192 tokens per some sources — **see the caveat above; 512 tokens was observed for the installed package** |

Laya is the fit here: local-first (ADR 0002), no API key, no third-party
text leaving the machine — which matters since #368's third-party-fetched
interpretation text can't be redistributed. Jev would mean sending both
interpretations (including the third-party one) to an external API.

## Why a typed judge instead of string matching

Astrological readings lean on symbolic language and jargon ("Saturn's heavy
weight" vs. "a period of structural discipline," houses, aspects, transit
angles) that plain string/token overlap scores badly. Laya/Jev evaluate
semantic intent rather than raw overlap, which is the actual point of using
one here instead of, say, a diff or BLEU-style metric.

**Lighter-weight alternative, if a single raw similarity number is all
that's needed**: a sentence-embedding model (e.g. `all-MiniLM-L6-v2` via
`sentence-transformers`) with cosine similarity is a standard, much cheaper
alternative to a full System-1 judge — worth considering if Laya's
noul/score judgment and a plain embedding similarity turn out to agree
closely in practice; the sanity-check step #368 already calls for should
probably compare the two.

## Investigated: replacing Laya with a small model served through Ollama

A follow-up research pass (2026-09-28, desk research only — nothing below
was spiked or run against a live model) asked whether Laya could be dropped
in favor of a lightweight model served through Ollama, since this project
already runs Ollama locally for corpus generation
(`docs/OLLAMA_CORPUS_GENERATION.md`). Conclusion: **not as a like-for-like
swap.** Keep Laya for the calibrated judgment; Ollama has a real, narrower
role instead. Full reasoning below.

### It's not the same kind of tool

Laya is a **non-autoregressive classifier** trained specifically to answer
typed questions in one forward pass — its `noul`/`score` outputs are
calibrated probabilities/distributions because calibration on exactly this
kind of judgment _was_ the training objective.

An Ollama-served model is a **general-purpose next-token predictor**.
Asking it "rate similarity 0-3 and return JSON" doesn't produce a calibrated
probability — it produces a token the model judged plausible to emit next.
Concretely:

- **Calibration**: an LLM's self-reported `"confidence": 0.87` in a JSON
  blob isn't backed by any calibration objective — it's the model narrating
  a plausible-sounding number. Small instruct models lean toward
  overconfident, clustered scores (e.g. everything lands 7-9/10).
- **Structured-output reliability**: Ollama's `format` field (JSON-Schema-
  constrained decoding — already used by this repo's own
  `tools/corpus-gen/lib/ollama.mjs`) reliably forces syntactically valid
  JSON matching a schema. It does **not** force the _values_ to be
  meaningful — a model can validly emit `{"score": 3}` while having reasoned
  incoherently. The malformed-output failure mode is well solved; the
  wrong-judgment failure mode isn't touched by schema constraints at all.
- **Throughput**: this doc already notes Laya runs ~33ms/query once loaded.
  A generative model has to decode a full JSON completion token-by-token —
  easily 1-5+ seconds per call even at 3B, an order of magnitude or more
  slower per judgment. Matters for a batch job like #368's (potentially
  hundreds of placement pairs), though still tractable given this project
  already accepts multi-minute Ollama batch runs for corpus generation.
- **Order bias**: LLM judges are known to be sensitive to which text is
  presented first in a head-to-head prompt — a real risk for any A/B
  comparison framing that Laya's typed-question API doesn't have to worry
  about.

Net: swapping Laya for an Ollama LLM trades a calibrated instrument for a
generative model role-playing one. That's a real downgrade for anything
that leans on the confidence number itself (this doc's own "P(true)=0.95 is
confident, 0.55 is a shrug" framing) — much less of one for a coarse
pass/fail signal in a human-reviewed report, which is closer to how #368
actually uses this.

### The same context-window trap that bit Laya also exists in Ollama — and already applies to this repo's own tooling

Confirmed directly against Ollama's own docs (`docs/context-length.mdx` in
the `ollama/ollama` repo): Ollama's **default** context length isn't fixed
per model — it's capped by the serving machine's VRAM tier (under 24 GiB
VRAM → 4k tokens default), regardless of what the model architecturally
supports (e.g. Llama 3.2's marketed 128K), unless overridden with
`OLLAMA_CONTEXT_LENGTH` server-wide or a per-request `num_ctx` option.
`ollama ps` shows what's actually allocated — the way to verify this rather
than trusting a model's marketing page, the same lesson this doc's own
512-vs-8192 caveat already teaches about Laya.

**This already applies, unaddressed, to `tools/corpus-gen/lib/ollama.mjs`**:
its request body sets `model`, `messages`, `format`, `stream`, and
`options: { temperature }` — no `num_ctx`. Every corpus-gen Ollama call
today (default model `mistral`) runs at whatever the VRAM-tier default
resolves to on the machine that runs it, not at any figure someone might
assume from the model's marketing. Flagged here as a pre-existing gap
worth a fix independent of the Laya question — not addressed by this
research pass.

### Models checked

Verified live against Ollama's own library pages (context figures are
Ollama's _listed_ numbers, still subject to the VRAM-tier default above
unless `num_ctx` is set explicitly):

| Model        | Sizes checked      | Ollama-listed context                                                | Notes                                                                                                                                          |
| ------------ | ------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Qwen2.5      | 0.5b/1.5b/3b/7b    | 32K input (Qwen's own docs note practical generation caps around 8K) | Marketed for instruction-following/JSON output; Apache-2.0 for most sizes                                                                      |
| Qwen3        | 0.6b/1.7b/4b/8b    | 40K (0.6b/1.7b/8b/14b/32b); 256K (4b, 30b-MoE, 235b)                 | Ships with "thinking" mode on by default for several variants — reasoned-not-verified: adds latency/tokens per call unless explicitly disabled |
| Llama 3.2    | 1b/3b              | 128K listed                                                          | Good general instruction-following; less JSON-specific focus than Qwen                                                                         |
| Phi-3.5-mini | 3.8B               | 128K listed                                                          | Strong instruction tuning (SFT+PPO+DPO); no explicit JSON-quality claim found                                                                  |
| Gemma 3      | 270m/1b/4b/12b/27b | 32K (270m/1b), 128K (4b+)                                            | 270M/1B are text-only and fast — smallest realistic instruction-follower in the set                                                            |

No dedicated NLI/cross-encoder-style model was found in Ollama's library —
those (e.g. `cross-encoder/nli-deberta-v3-base`) are typically served via
`sentence-transformers`/`transformers` directly, since Ollama's library is
oriented entirely around generative chat/instruct models. Inferred from
what the library actually contains, not confirmed as a documented absence.

**Embedding models, directly confirmed available in Ollama's own library**:
`all-minilm` (22m/33m — the Ollama-served equivalent of the sentence-
embedding alternative already floated above), plus `nomic-embed-text`,
`mxbai-embed-large`, `bge-m3`, and others, servable via Ollama's `/api/embed`
endpoint. This is a materially better fit for raw text-vs-text similarity
than any generative judge — a single forward pass, no JSON parsing, a
well-understood continuous metric. It does **not** cover #368's actual
fact-grounding use case, though: that's text-vs-facts, not text-vs-text, a
different question shape entirely.

### Practical integration shape, if pursued

Would closely mirror the existing `generateStructured()` in
`tools/corpus-gen/lib/ollama.mjs`: POST to `/api/chat` with `format` set to
a JSON Schema (e.g. `{ score: integer 0-3, rationale: string }`), with
`options: { temperature: 0, num_ctx: <explicitly chosen> }` — temperature 0
for determinism (Ollama's own structured-outputs guidance recommends this),
`num_ctx` set explicitly to avoid the silent-default trap above. A new
failure mode beyond the existing retry-on-5xx logic: a syntactically valid
but semantically empty judgment (e.g. score always "1") isn't an HTTP-level
failure, so it isn't caught by the current retryable-status handling —
would need either a spot-check pass or discarding low-signal outputs.

### Recommendation

**Don't do a wholesale Laya-to-Ollama-LLM swap for the calibrated
similarity/fact-grounding judgment.** The kind-of-tool change above is real:
trading a purpose-calibrated classifier for a generative model's narrated
approximation of a score, at materially worse throughput, to remove a
dependency (Laya's ~1.7GB ONNX cache) that's already installed and working.
That trade only makes sense if Laya's calibration turns out not to transfer
to astrology prose — a real, already-flagged risk (see the truncation
caveat above).

Recommended combination instead:

1. **Keep Laya** for #368's fact-grounding judgment. Its context-truncation
   risk is now confirmed, not just flagged (above): a realistic ~300-320
   token budget for `state`, comfortably enough for a single interpretation
   paragraph against a short facts string, but not for two full paragraphs
   packed together.
2. **Add `all-minilm` via Ollama's `/api/embed`** as a free, fast first-pass
   similarity signal for the _standalone two-interpretation comparison
   tool_ specifically (not #368's fact-grounding case, which isn't a
   text-vs-text problem). No new dependency beyond pulling one more small
   Ollama model — stays local-only, satisfying the same constraint Laya was
   chosen for — and makes this doc's own suggested "does Laya agree with a
   plain embedding?" sanity check trivial to run, since both would be
   reachable through the same local Ollama server.
3. **Only reach for a generative Ollama LLM as judge** (Qwen2.5-3B or
   Qwen3-4B are the best-supported candidates for structured JSON per the
   table above, with `num_ctx` explicit and temperature 0) if a spike shows
   Laya's calibration genuinely doesn't hold up on real astrology prose —
   the fallback, not the first move.

### Decision (2026-09-28)

Keep Laya only for #368's fact-grounding judge; the `all-minilm` addition
and any generative-LLM fallback stay deferred, not adopted now. The
context-limit question above is resolved (confirmed via config + source
inspection, no live inference run needed) and is no longer a blocker for the
Part 3 sketch in #368's write-up.

### Still open

- Whether `all-minilm` cosine similarity and Laya's `noul`/`score` actually
  agree on a handful of known-similar/known-dissimilar interpretation
  pairs — this doc's own suggested check, still unrun.
- If a generative-LLM judge is ever pursued: whether Qwen2.5/Qwen3's stated
  scores are reproducible across repeated runs at temperature 0, and
  whether Qwen3's default thinking-mode needs explicit suppression for
  latency reasons.
- The actual `num_ctx` needed for realistic two-paragraph-plus-facts inputs,
  verified via `ollama ps`'s `CONTEXT` column on the machine(s) this
  actually runs on — not assumed from any model's marketing page.
