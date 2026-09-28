# 3. Tier-2 LLM-customized interpretation

- **Status:** accepted
- **Date:** 2026-09-28

## Context

The interpretation shown on the "Standard" tab (`ReportView.tsx`) is Tier 1:
committed, reviewed, locale-complete corpus text, assembled entirely
client-side with no network call and no account — the same offline-first
posture as the rest of the app (ADR 0002). Users asked for a version of that
text restyled to their own tone (warmer, blunter, more concise, focused on a
particular theme) without hand-editing it themselves.

That restyling step is the one place in Astraya's whole runtime where an LLM
call is unavoidable: it is a request-time transformation of user-chosen
style against already-correct facts, not a build-time batch job like
`tools/corpus-gen` (which produces the committed Tier-1 corpus offline, with
no per-user variation and no live request path). Introducing it raises three
questions ADR 0002 didn't have to answer: what data reaches a third party,
where the credential lives, and what bounds the cost of a feature whose
unit cost is no longer zero.

## Decision

**Tier 2 is opt-in, authenticated, and per-request-consented.** It lives in
its own "AI-Customized" sub-tab alongside "Standard", gated by
`requireUser` — any signed-in user, not admin-only — and by a plain,
never-persisted consent checkbox: consent authorizes one specific request,
not a standing preference.

**The client never sends birth data, chart data, or interpretation prose.**
It sends `placementKeys` (`report.ts`'s `reportPlacementKeys` — e.g.
`planet-in-sign:sun:4`) and `locale`. A placement key is structurally
incapable of carrying a name, a date, or coordinates: it is built by
`placementKey()` from a closed set of category/body/sign/house/aspect
tokens (`schema.ts`), not from anything a user typed. The server
(`server/interpretation-routes.ts`) re-resolves each key's grounded Tier-1
text against its own copy of the corpus (`resolvePlacementText`) — the
facts a model sees are always ones this app already reviewed and shipped,
never re-derived from the request.

**`customPrompt` is the one field that structural guarantee doesn't cover.**
Free-form style/tone/focus instructions can't be made structurally incapable
of carrying a birth date, a request for medical/legal/financial advice, or
an attempt to redirect the model rather than describe a style. This gets a
second, best-effort line of defense instead: `prompt-guardrail.ts`, a pure,
deterministic module (no model call, importable by both the client for an
inline UX nicety and the server as the authoritative check) that rejects a
prompt containing prompt-injection phrasing, fatalistic phrasing,
medical/legal/financial claim language, or a date/coordinate-shaped
substring. The server runs this check regardless of what the client already
filtered — a bypassed or absent client check is not a security gap, since
the client's pass was never the boundary.

**The credential and the model call live only in
`server/interpretation/llm-client.ts`**, never in `src/`.
`test/no-runtime-llm-access.test.ts` enforces that boundary the same way it
already does for `tools/corpus-gen`'s provider keys. The key, model, and
base URL are `.env.local`-only server environment variables
(`ASTRAYA_INTERPRETATION_API_KEY` etc.) and are never sent to the browser.
Left unset, the server still starts and Tier 1 is unaffected — only
`POST /api/interpretation/generate` is disabled, returning 503.

**Real dollar caps bound spend, on top of a per-user rate limit.** A
request-count limit alone doesn't bound spend, since one call's cost varies
with prompt/output length — so every call's actual token usage is recorded
(`interpretation_usage`, migration 8) and two caps, in cents, are checked
before every model call: `ASTRAYA_INTERPRETATION_USER_DAILY_CENTS` (default 50) and `ASTRAYA_INTERPRETATION_TOTAL_DAILY_CENTS` (default 500). Either cap
hit returns 503, the same "feature temporarily unavailable" signal as "not
configured" — a cost cap is an operational limit, not a client error, so it
gets the status code that means "try again later" rather than one that
implies the request itself was wrong. The per-user-per-hour request limit
(20/hour, keyed by user id) sits below both caps as an anti-abuse floor,
stopping a single account from burning through a lot of small, cheap calls
before either cap has accumulated enough usage to trip.

## Consequences

Good:

- Nothing about Tier 1 changes: no account, no network call, works fully
  offline, exactly as before. Tier 2 is additive, matching ADR 0002's own
  "sign-in and sync are additive" precedent.
- The structural PII-minimization (placement keys) doesn't depend on anyone
  remembering to scrub anything at request time — a key that never held a
  name can't leak one.
- The credential boundary is enforced by a test, not just a convention.

Costs, stated plainly:

- `customPrompt`'s guardrail is best-effort, not structural — it can't
  detect a birth date typed as a fragment ("the fourth of July") or a
  disguised injection attempt. It is documented as such rather than
  oversold as equivalent to the placement-key guarantee.
- The two cost caps are process-local counters over `interpretation_usage`,
  read fresh on every request — correct for Astraya's single-process
  deployment, but would need a shared store (not sqlite `:memory:`-per-
  process) if this server were ever run as more than one instance.
- Pricing constants in `llm-client.ts` (`estimateCostCents`) are documented
  as approximate; they bound spend to the right order of magnitude, not to
  the cent, and should be re-verified against the provider's published
  pricing periodically.
