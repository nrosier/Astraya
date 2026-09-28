/**
 * Tier 2 (#360): `POST /api/interpretation/generate`, the one runtime route
 * in Astraya that calls a third-party LLM. See
 * docs/adr/0003-tier-2-llm-customized-interpretation.md for the full
 * architecture — this file is the route itself.
 *
 * The client sends `placementKeys` (from `report.ts`'s `reportPlacementKeys`)
 * rather than birth data or chart-derived text: each key is re-resolved
 * against this server's own copy of the corpus (`resolvePlacementText`), so
 * no interpretation prose or personal data crosses the wire from the client,
 * only the structurally de-identified keys ADR 0003 documents. `customPrompt`
 * is the one free-text field that structural constraint doesn't cover, so it
 * is run through `checkCustomPrompt` here — authoritatively, regardless of
 * whether the client already filtered it — before it is ever combined with
 * the resolved facts and sent to the model.
 *
 * Gated by `requireUser`: any signed-in user, not admin-only, since this is
 * a per-user feature, not an admin one. Rate-limited per user (not global)
 * on top of the two real dollar caps below — a request-count limit alone
 * doesn't bound spend, since one call's cost varies with prompt/output
 * length, but it still stops a single account from hammering the route
 * before either cap has accumulated enough usage to trip.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from './db.ts';
import { requireUser } from './auth/identity.ts';
import { loadTier2Config, generateTier2Text, estimateCostCents } from './interpretation/llm-client.ts';
import { recordUsage, userCostCentsSince, totalCostCentsSince } from './interpretation/usage.ts';
import { checkCustomPrompt } from '../src/interpretation/prompt-guardrail.ts';
import { CORPUS_LOCALES, parsePlacementKey, validateKey, type Locale } from '../src/interpretation/schema.ts';
import { resolvePlacementText } from '../src/interpretation/compose.ts';
import { CORPUS } from '../src/interpretation/index.ts';

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (CORPUS_LOCALES as readonly string[]).includes(value);
}

interface GenerateBody {
  readonly placementKeys?: unknown;
  readonly customPrompt?: unknown;
  readonly locale?: unknown;
}

/** `requireUser` is this route's preHandler, so by the time a handler body runs this cannot be unset. */
function authenticatedUserId(request: FastifyRequest): string {
  if (!request.user) throw new Error('requireUser preHandler did not run before this handler.');
  return request.user.id;
}

const SYSTEM_INSTRUCTION = [
  'You restyle astrological interpretation text that has already been written and',
  'fact-checked by this application. You are given a list of grounded facts —',
  'each already correct and already reviewed — and a short instruction describing',
  'the style, tone, or focus the reader wants. Rewrite the facts into flowing prose',
  'matching that style. Do not invent new facts, placements, dates, or claims not',
  'present in the facts given to you. Do not give medical, legal, or financial',
  'advice, and do not use fatalistic or absolute ("you will never...") phrasing.',
].join(' ');

// A real report has a few dozen placements at most; this is a generous ceiling against
// a request padded with junk entries to inflate token usage/cost per call.
const MAX_PLACEMENT_KEYS = 200;

/**
 * Reads a cost-cap env var, failing closed (cap of 0, i.e. blocked) on a
 * non-numeric value rather than `Number(...)`'s `NaN`, against which every
 * `>=` comparison is always false — a misconfigured cap must not silently
 * become "no cap."
 */
function envCapCents(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}

function buildUserContent(facts: readonly string[], customPrompt: string, locale: Locale): string {
  const language = locale === 'nl' ? 'Dutch' : 'English';
  return [
    `Write in ${language}.`,
    '',
    'Style, tone, and focus instructions from the reader:',
    customPrompt,
    '',
    'Grounded facts to restyle (do not add facts beyond these):',
    ...facts.map((fact) => `- ${fact}`),
  ].join('\n');
}

export function registerInterpretationRoutes(app: FastifyInstance, db: Database): void {
  app.post<{ Body: GenerateBody }>(
    '/api/interpretation/generate',
    {
      preHandler: requireUser(db),
      // Per-user, not per-IP: `keyGenerator` needs `request.user`, which only
      // `requireUser` (this route's own preHandler) sets — `hook: 'preHandler'`
      // runs this after that preHandler rather than at the default `onRequest`,
      // when `request.user` would not exist yet. 20/hour is an anti-abuse floor,
      // not the real spend control — the two cost caps below are.
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 hour',
          hook: 'preHandler',
          keyGenerator: (request: FastifyRequest) => request.user?.id ?? request.ip,
        },
      },
    },
    async (request, reply) => {
      const { placementKeys, customPrompt, locale } = request.body;

      if (!Array.isArray(placementKeys) || placementKeys.length === 0) {
        return reply.code(400).send({ error: 'placementKeys must be a non-empty array' });
      }
      if (placementKeys.length > MAX_PLACEMENT_KEYS) {
        return reply.code(400).send({ error: `placementKeys must not exceed ${String(MAX_PLACEMENT_KEYS)} entries` });
      }
      if (!placementKeys.every((key) => typeof key === 'string')) {
        return reply.code(400).send({ error: 'placementKeys must all be strings' });
      }
      // `validateKey` re-derives each placement and checks its body/aspect is in the closed
      // reference set and its sign/house/pattern is in range — not just that the key parses
      // (`parsePlacementKey`'s weaker job). Without this, an attacker-chosen `body`/`aspect`
      // string would be echoed verbatim into the model prompt below, bypassing `checkCustomPrompt`
      // entirely via a field that check never inspects.
      const keyErrors = placementKeys.flatMap((key) => validateKey(key));
      if (keyErrors.length > 0) {
        return reply
          .code(400)
          .send({ error: `placementKeys must all be well-formed placement keys: ${keyErrors.join('; ')}` });
      }
      const parsedPlacements = placementKeys.map((key) => parsePlacementKey(key));
      if (typeof customPrompt !== 'string') {
        return reply.code(400).send({ error: 'customPrompt must be a string' });
      }
      if (!isLocale(locale)) {
        return reply.code(400).send({ error: `locale must be one of ${CORPUS_LOCALES.join(', ')}` });
      }

      const guardrailIssues = checkCustomPrompt(customPrompt);
      if (guardrailIssues.length > 0) {
        return reply
          .code(400)
          .send({ error: `customPrompt failed: ${guardrailIssues.map((issue) => issue.message).join('; ')}` });
      }

      const config = loadTier2Config();
      if (config === undefined) {
        return reply.code(503).send({ error: 'Tier 2 (AI-customized interpretation) is not configured' });
      }

      const userId = authenticatedUserId(request);
      const userDailyCapCents = envCapCents('ASTRAYA_INTERPRETATION_USER_DAILY_CENTS', 50);
      const totalDailyCapCents = envCapCents('ASTRAYA_INTERPRETATION_TOTAL_DAILY_CENTS', 500);
      if (userCostCentsSince(db, userId) >= userDailyCapCents) {
        return reply.code(503).send({ error: 'Daily usage limit reached for your account. Try again tomorrow.' });
      }
      if (totalCostCentsSince(db) >= totalDailyCapCents) {
        return reply.code(503).send({ error: 'Daily usage limit reached for this deployment. Try again tomorrow.' });
      }

      // Safe: `validateKey` above already confirmed every key parses.
      const placements = parsedPlacements as readonly NonNullable<(typeof parsedPlacements)[number]>[];
      const facts = placements.map((placement) => resolvePlacementText(placement, locale, CORPUS));
      const userContent = buildUserContent(facts, customPrompt, locale);

      let result;
      try {
        result = await generateTier2Text(config, SYSTEM_INSTRUCTION, userContent);
      } catch (error) {
        request.log.error(error, 'Tier 2 model call failed');
        return reply.code(502).send({ error: 'The AI-customized interpretation could not be generated right now.' });
      }

      const costCents = estimateCostCents(result.promptTokens, result.outputTokens);
      recordUsage(db, {
        userId,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        costCents,
      });

      return reply.send({ text: result.text });
    },
  );
}
