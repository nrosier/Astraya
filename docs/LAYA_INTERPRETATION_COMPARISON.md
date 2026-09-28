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

**Context window discrepancy to verify before relying on either number**:
this note's source claims Laya supports contexts "up to 8,192 tokens."
Earlier direct inspection of the installed package's behavior found `state`
truncated to 512 tokens _after_ the question header is appended — a real
constraint for packing two full interpretation paragraphs plus a question
into one call. Don't trust either figure blindly; check the installed
version's actual truncation behavior (or its docs/changelog) before sizing
inputs for the comparison tool.

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
