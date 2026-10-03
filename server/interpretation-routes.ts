/**
 * Tier 2 (#360): `POST /api/interpretation/generate`, the one runtime route
 * in Astraya that calls a third-party LLM. See
 * docs/adr/0003-tier-2-llm-customized-interpretation.md for the full
 * architecture — this file is the route itself.
 *
 * Three modes:
 * - `'grounded'` (default, unchanged since #360): the client sends
 *   `placementKeys` (from `report.ts`'s `reportPlacementKeys`) rather than
 *   birth data or chart-derived text; each key is re-resolved against this
 *   server's own copy of the corpus (`resolvePlacementText`), so no
 *   interpretation prose or personal data crosses the wire from the client,
 *   only the structurally de-identified keys ADR 0003 documents, and the
 *   model only restyles that given text.
 * - `'freeform'`: the client sends `chartData` (computed positions/houses/
 *   aspects), and the model originates its own interpretation from it —
 *   deliberately giving up the "no chart data crosses the wire" guarantee
 *   for this mode only, per ADR 0003's updated scope. `validateChartData`
 *   below re-derives and closed-set-checks every numeric id/key, the same
 *   reason `validateKey` does for grounded mode: untrusted client data must
 *   never reach the third-party prompt unchecked.
 * - `'synthesis'` (#377): same `chartData` validation and fact-building as
 *   `'freeform'`, but with a fixed task — reason across the whole chart's
 *   placements together rather than restyling/originating per a
 *   reader-supplied instruction — so it carries no `customPrompt` field at
 *   all. #377 investigated this as a two-stage "synthesis + refinement"
 *   pipeline; refinement turned out to already be covered by `'grounded'`
 *   mode (restyle already-reviewed text) and unnecessary as a second chained
 *   call on top of synthesis's own output, so this is the one new mode that
 *   capability actually needed.
 *
 * `customPrompt` is the one free-text field neither mode's structural
 * constraint covers, so it is run through `checkCustomPrompt` here —
 * authoritatively, regardless of whether the client already filtered it —
 * before it is ever combined with the resolved facts and sent to the model.
 * That phrase-list check is only a cheap pre-filter: a reworded request slips
 * past any fixed list, so a passing prompt then goes through a separate
 * model verification call (#411) that answers only `pass` or `fail: <reason>`.
 * Generation runs only on `pass`; a `fail`, an unparseable answer, or a failed
 * verification call all stop the request before generation (fail closed).
 *
 * Gated by `requireUser`: any signed-in user, not admin-only, since this is
 * a per-user feature, not an admin one. Rate-limited per user (not global)
 * on top of the two real dollar caps below — a request-count limit alone
 * doesn't bound spend, since one call's cost varies with prompt/output
 * length, but it still stops a single account from hammering the route
 * before either cap has accumulated enough usage to trip.
 *
 * A successful generation is also saved (#392, `interpretation/results.ts`) so the user who
 * generated it can reopen it later via `GET /api/interpretation/results[/:id]` without calling
 * the model again — encrypted at rest the same way `ops.payload` is, and only when
 * `ASTRAYA_INTERPRETATION_API_KEY`'s sibling encryption setting, `ASTRAYA_ENCRYPTION_KEY`, is
 * configured. Missing that key disables saving, not generation — the two are independent.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from './db.ts';
import { requireUser, requireAdmin } from './auth/identity.ts';
import {
  loadTier2Config,
  generateTier2Text,
  verifyCustomPrompt,
  estimateCostCents,
} from './interpretation/llm-client.ts';
import {
  recordUsage,
  userCostCentsSince,
  totalCostCentsSince,
  usageByUser,
  costCentsSinceByUser,
} from './interpretation/usage.ts';
import { checkCustomPrompt } from '../src/interpretation/prompt-guardrail.ts';
import { loadEncryptionKey } from './ops/crypto.ts';
import {
  saveInterpretationResult,
  listInterpretationResults,
  getInterpretationResult,
} from './interpretation/results.ts';
import { CORPUS_LOCALES, parsePlacementKey, validateKey, type Locale } from '../src/interpretation/schema.ts';
import { resolvePlacementText } from '../src/interpretation/compose.ts';
import { CORPUS } from '../src/interpretation/index.ts';
import { bodyById } from '../src/astrology/bodies.ts';
import { aspectByKey } from '../src/astrology/aspects.ts';
import { signOf, degreesInSign } from '../src/astrology/signs.ts';
import { houseOf } from '../src/astrology/emphasis.ts';

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (CORPUS_LOCALES as readonly string[]).includes(value);
}

type Mode = 'grounded' | 'freeform' | 'synthesis';

function isMode(value: unknown): value is Mode {
  return value === 'grounded' || value === 'freeform' || value === 'synthesis';
}

interface GenerateBody {
  readonly mode?: unknown;
  readonly placementKeys?: unknown;
  readonly chartData?: unknown;
  readonly customPrompt?: unknown;
  readonly locale?: unknown;
}

/** Freeform mode's validated wire shape — hand-mirrors `src/interpretation/tier2-client.ts`'s `Tier2ChartDataPayload`. */
interface ChartDataPayload {
  readonly positions: readonly { readonly body: number; readonly longitude: number }[];
  readonly houses: { readonly cusps: readonly number[]; readonly ascendant: number; readonly midheaven: number };
  readonly aspects: readonly {
    readonly bodyA: number;
    readonly bodyB: number;
    readonly aspectKey: string;
    readonly separation: number;
    readonly orb: number;
  }[];
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
  'Organize your response into 2 to 4 short thematic sections, each with a brief',
  'heading and a 1 to 3 sentence body — never one long undivided paragraph (#376).',
].join(' ');

const FREEFORM_SYSTEM_INSTRUCTION = [
  'You write an original astrological interpretation from a list of grounded',
  'chart facts — exact placements, houses, and aspects, already computed and',
  'correct — and a short instruction describing the style, tone, or focus the',
  'reader wants. Unlike a restyling task, you originate the interpretation',
  "yourself: draw on the reader's chart facts to say what they mean, not just",
  'reword them. Stay strictly within the facts given to you — do not invent',
  'placements, aspects, dates, or claims not present in them. Do not give',
  'medical, legal, or financial advice, and do not use fatalistic or absolute',
  '("you will never...") phrasing. Organize your response into 2 to 4 short',
  'thematic sections, each with a brief heading and a 1 to 3 sentence body —',
  'never one long undivided paragraph.',
].join(' ');

const SYNTHESIS_SYSTEM_INSTRUCTION = [
  'You are a psychologically grounded astrologer writing a synthesized reading',
  'of a whole natal chart from a list of grounded chart facts — exact placements,',
  'houses, and aspects, already computed and correct. You are given several of',
  "this chart's placements and aspects at once. Do not describe each one",
  'independently in its own section — reason across them together, the way a',
  'human astrologer integrating a whole chart would: note where placements',
  'reinforce each other, where they create internal tension, and what unified',
  'pattern of personality emerges from the combination. Stay strictly within the',
  'facts given to you — do not invent placements, aspects, dates, or claims not',
  'present in them. Do not give medical, legal, or financial advice, and do not',
  'use fatalistic or absolute ("you will never...") phrasing. Organize your',
  'response into 2 to 4 short thematic sections, each with a brief heading and a',
  '1 to 3 sentence body — never one long undivided paragraph.',
].join(' ');

// A real report has a few dozen placements at most; this is a generous ceiling against
// a request padded with junk entries to inflate token usage/cost per call.
const MAX_PLACEMENT_KEYS = 200;

// A real chart has a couple dozen bodies at most (planets, angles, nodes, asteroids); a
// full house wheel is always 13 entries (index 0 unused, 1..12 real); a real chart has at
// most a few hundred aspect pairs. Generous ceilings against a padded request inflating cost.
const MAX_BODIES = 40;
const HOUSE_CUSP_COUNT = 13;
const MAX_ASPECTS = 200;

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
    'Grounded facts (do not add facts beyond these):',
    ...facts.map((fact) => `- ${fact}`),
  ].join('\n');
}

/** Synthesis mode's user content — unlike `buildUserContent`, there is no reader-supplied style instruction: the task itself is fixed (`SYNTHESIS_SYSTEM_INSTRUCTION`). */
function buildSynthesisUserContent(facts: readonly string[], locale: Locale): string {
  const language = locale === 'nl' ? 'Dutch' : 'English';
  return [
    `Write in ${language}.`,
    '',
    'Computed placements and aspects (do not add facts beyond these):',
    ...facts.map((fact) => `- ${fact}`),
    '',
    'Write the synthesized reading.',
  ].join('\n');
}

/** `max` is exclusive — matches longitude's `[0, 360)` convention. */
function isFiniteNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value < max;
}

function isFiniteNumberInClosedRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Re-derives and closed-set-validates freeform mode's `chartData` payload —
 * the same reason `validateKey` does this for grounded mode's
 * `placementKeys`: an attacker-chosen body id, aspect key, or out-of-range
 * angle would otherwise be echoed into the model prompt unchecked.
 */
function validateChartData(payload: unknown): { chartData: ChartDataPayload } | { errors: string[] } {
  const errors: string[] = [];
  if (typeof payload !== 'object' || payload === null) {
    return { errors: ['chartData must be an object'] };
  }
  const { positions, houses, aspects } = payload as Record<string, unknown>;

  if (!Array.isArray(positions) || positions.length === 0) {
    errors.push('chartData.positions must be a non-empty array');
  } else if (positions.length > MAX_BODIES) {
    errors.push(`chartData.positions must not exceed ${String(MAX_BODIES)} entries`);
  } else {
    for (const [index, entry] of positions.entries()) {
      if (typeof entry !== 'object' || entry === null) {
        errors.push(`chartData.positions[${String(index)}] must be an object`);
        continue;
      }
      const { body, longitude } = entry as Record<string, unknown>;
      if (typeof body !== 'number' || bodyById(body) === undefined) {
        errors.push(`chartData.positions[${String(index)}].body must be a known body id`);
      }
      if (!isFiniteNumberInRange(longitude, 0, 360)) {
        errors.push(`chartData.positions[${String(index)}].longitude must be a number in [0, 360)`);
      }
    }
  }

  if (typeof houses !== 'object' || houses === null) {
    errors.push('chartData.houses must be an object');
  } else {
    const { cusps, ascendant, midheaven } = houses as Record<string, unknown>;
    if (!Array.isArray(cusps) || cusps.length !== HOUSE_CUSP_COUNT) {
      errors.push(`chartData.houses.cusps must be an array of exactly ${String(HOUSE_CUSP_COUNT)} entries`);
    } else if (
      // Index 0 is unused (see `HOUSE_CUSP_COUNT`'s own comment and `HousePositions.cusps`'s
      // doc comment in `ephemeris/types.ts`) — `houseOf` (this route's only reader of
      // `chartData.houses.cusps`, below) never looks at it, so it is never a real degree
      // value and must not be held to the same [0, 360) requirement as indices 1..12. Checking
      // it anyway rejected every single freeform request, always, regardless of chart (#372's
      // sibling bug report): `toTier2ChartPayload` sends `HousePositions` verbatim, so
      // `cusps[0]` was always this placeholder, never a real house cusp.
      !cusps.slice(1).every((cusp) => isFiniteNumberInRange(cusp, 0, 360))
    ) {
      errors.push('chartData.houses.cusps entries 1..12 must all be numbers in [0, 360)');
    }
    if (!isFiniteNumberInRange(ascendant, 0, 360)) {
      errors.push('chartData.houses.ascendant must be a number in [0, 360)');
    }
    if (!isFiniteNumberInRange(midheaven, 0, 360)) {
      errors.push('chartData.houses.midheaven must be a number in [0, 360)');
    }
  }

  if (!Array.isArray(aspects)) {
    errors.push('chartData.aspects must be an array');
  } else if (aspects.length > MAX_ASPECTS) {
    errors.push(`chartData.aspects must not exceed ${String(MAX_ASPECTS)} entries`);
  } else {
    for (const [index, entry] of aspects.entries()) {
      if (typeof entry !== 'object' || entry === null) {
        errors.push(`chartData.aspects[${String(index)}] must be an object`);
        continue;
      }
      const { bodyA, bodyB, aspectKey, separation, orb } = entry as Record<string, unknown>;
      if (typeof bodyA !== 'number' || bodyById(bodyA) === undefined) {
        errors.push(`chartData.aspects[${String(index)}].bodyA must be a known body id`);
      }
      if (typeof bodyB !== 'number' || bodyById(bodyB) === undefined) {
        errors.push(`chartData.aspects[${String(index)}].bodyB must be a known body id`);
      }
      if (typeof aspectKey !== 'string' || aspectByKey(aspectKey) === undefined) {
        errors.push(`chartData.aspects[${String(index)}].aspectKey must be a known aspect key`);
      }
      if (!isFiniteNumberInClosedRange(separation, 0, 180)) {
        errors.push(`chartData.aspects[${String(index)}].separation must be a number in [0, 180]`);
      }
      if (typeof orb !== 'number' || !Number.isFinite(orb) || orb < 0) {
        errors.push(`chartData.aspects[${String(index)}].orb must be a non-negative number`);
      }
    }
  }

  if (errors.length > 0) return { errors };
  return { chartData: payload as ChartDataPayload };
}

function formatLongitude(longitude: number): string {
  return `${degreesInSign(longitude).toFixed(1)}° ${signOf(longitude).name}`;
}

/** Turns validated `chartData` into human-readable facts the model can originate an interpretation from — reusing the same sign/house formatting primitives `report.ts` already uses, not new formatting logic. */
function buildFreeformFacts(chartData: ChartDataPayload): string[] {
  const facts: string[] = [];
  for (const position of chartData.positions) {
    const body = bodyById(position.body);
    if (body === undefined) continue;
    const house = houseOf(position.longitude, chartData.houses.cusps);
    facts.push(`${body.name}: ${formatLongitude(position.longitude)}, house ${String(house)}`);
  }
  facts.push(`Ascendant: ${formatLongitude(chartData.houses.ascendant)}`);
  facts.push(`Midheaven: ${formatLongitude(chartData.houses.midheaven)}`);
  for (const aspect of chartData.aspects) {
    const bodyA = bodyById(aspect.bodyA);
    const bodyB = bodyById(aspect.bodyB);
    const aspectDefinition = aspectByKey(aspect.aspectKey);
    if (bodyA === undefined || bodyB === undefined || aspectDefinition === undefined) continue;
    facts.push(`${bodyA.name} ${aspectDefinition.name} ${bodyB.name} (orb ${aspect.orb.toFixed(1)}°)`);
  }
  return facts;
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
      const { mode: rawMode, placementKeys, chartData, customPrompt, locale } = request.body;

      // A missing `mode` defaults to `'grounded'` — this route's original, only behavior — so
      // this isn't a breaking change for any caller that predates freeform mode.
      const mode: Mode | undefined = rawMode === undefined ? 'grounded' : isMode(rawMode) ? rawMode : undefined;
      if (mode === undefined) {
        return reply.code(400).send({ error: "mode must be 'grounded', 'freeform', or 'synthesis'" });
      }

      // Synthesis mode is a fixed task with no reader-supplied style instruction, so it carries
      // no `customPrompt` field at all — unlike grounded/freeform, which both require one.
      if (mode !== 'synthesis') {
        if (typeof customPrompt !== 'string') {
          return reply.code(400).send({ error: 'customPrompt must be a string' });
        }
        const guardrailIssues = checkCustomPrompt(customPrompt);
        if (guardrailIssues.length > 0) {
          return reply
            .code(400)
            .send({ error: `customPrompt failed: ${guardrailIssues.map((issue) => issue.message).join('; ')}` });
        }
      }
      if (!isLocale(locale)) {
        return reply.code(400).send({ error: `locale must be one of ${CORPUS_LOCALES.join(', ')}` });
      }

      let facts: string[];
      let systemInstruction: string;
      if (mode === 'grounded') {
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
        // Safe: `validateKey` above already confirmed every key parses.
        const parsedPlacements = placementKeys.map((key) => parsePlacementKey(key));
        const placements = parsedPlacements as readonly NonNullable<(typeof parsedPlacements)[number]>[];
        facts = placements.map((placement) => resolvePlacementText(placement, locale, CORPUS));
        systemInstruction = SYSTEM_INSTRUCTION;
      } else {
        const validated = validateChartData(chartData);
        if ('errors' in validated) {
          return reply.code(400).send({ error: `chartData is invalid: ${validated.errors.join('; ')}` });
        }
        facts = buildFreeformFacts(validated.chartData);
        systemInstruction = mode === 'synthesis' ? SYNTHESIS_SYSTEM_INSTRUCTION : FREEFORM_SYSTEM_INSTRUCTION;
      }

      const config = loadTier2Config();
      if (config === undefined) {
        // Deliberately not disclosed in the client-facing 503 body (an unauthenticated caller
        // shouldn't learn server env var names), but an admin reading logs has no other way to
        // tell this apart from "this deployment doesn't support Tier 2 at all" — GEMINI_API_KEY
        // (corpus-gen, build-time-only) being set does NOT satisfy this; #375.
        request.log.warn(
          'Tier 2 request rejected: ASTRAYA_INTERPRETATION_API_KEY is not set (GEMINI_API_KEY does not count — it is a separate, build-time-only credential for corpus generation).',
        );
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

      if (mode !== 'synthesis') {
        let verification;
        try {
          verification = await verifyCustomPrompt(
            config,
            customPrompt as string,
            locale === 'nl' ? 'Dutch' : 'English',
            2,
            request.log,
          );
        } catch (error) {
          request.log.error(error, 'Tier 2 custom-prompt verification call failed');
          return reply.code(502).send({ error: 'Your instruction could not be verified right now. Try again later.' });
        }
        // The verification call costs tokens whatever its verdict, so it counts toward both caps.
        recordUsage(db, {
          userId,
          promptTokens: verification.promptTokens,
          outputTokens: verification.outputTokens,
          costCents: estimateCostCents(verification.promptTokens, verification.outputTokens),
        });
        if (verification.result.verdict === 'fail') {
          const reason = verification.result.reason ?? null;
          return reply.code(422).send({
            error: `This instruction violates the allowed customization rules${reason === null ? '.' : `: ${reason}`}`,
            code: 'customization-rejected',
            reason,
          });
        }
      }

      const userContent =
        mode === 'synthesis'
          ? buildSynthesisUserContent(facts, locale)
          : buildUserContent(facts, customPrompt as string, locale);

      let result;
      try {
        result = await generateTier2Text(config, systemInstruction, userContent, 2, request.log);
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

      // Saving for later retrieval (#392) is additive, not this route's primary job — a missing
      // encryption key disables it the same way it disables the sync relay (never write
      // unencrypted), but unlike the relay that must not fail the generation that already
      // succeeded; the reader just won't be able to reopen this one later.
      const resultsKey = loadEncryptionKey();
      if (resultsKey) {
        saveInterpretationResult(db, { userId, mode, locale, sections: result.sections }, resultsKey);
      }

      return reply.send({ sections: result.sections });
    },
  );

  // Lists this user's own past generations (metadata only — mode/locale/when, never the text
  // itself, so this works even when ASTRAYA_ENCRYPTION_KEY has since been removed or rotated).
  app.get(
    '/api/interpretation/results',
    { preHandler: requireUser(db), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = authenticatedUserId(request);
      return reply.send({ results: listInterpretationResults(db, userId) });
    },
  );

  // Re-opens one of this user's own past generations without calling the model again.
  app.get<{ Params: { id: string } }>(
    '/api/interpretation/results/:id',
    { preHandler: requireUser(db), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const userId = authenticatedUserId(request);
      const key = loadEncryptionKey();
      if (!key) {
        return reply.code(503).send({ error: 'Saved interpretations are not available on this server.' });
      }
      const found = getInterpretationResult(db, userId, request.params.id, key);
      if (!found) return reply.code(404).send({ error: 'No saved interpretation with that id.' });
      return reply.send(found);
    },
  );

  // Admin-only (#382): the two daily caps above already read interpretation_usage before every
  // call, but nothing before this let anyone — admin or otherwise — actually look at it. All-time
  // per-user totals plus each user's own last-24h spend (to compare against the per-user cap) and
  // the two configured cap values themselves, so an admin can see how close an account or this
  // deployment is to being throttled, not just that it happened after the fact in a 503.
  app.get(
    '/api/admin/interpretation-usage',
    { preHandler: requireAdmin(db), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (_request, reply) => {
      const costCentsLast24hByUser = costCentsSinceByUser(db);
      const users = usageByUser(db).map((user) => ({
        ...user,
        costCentsLast24h: costCentsLast24hByUser.get(user.userId) ?? 0,
      }));
      return reply.send({
        users,
        totalCostCentsLast24h: totalCostCentsSince(db),
        caps: {
          userDailyCapCents: envCapCents('ASTRAYA_INTERPRETATION_USER_DAILY_CENTS', 50),
          totalDailyCapCents: envCapCents('ASTRAYA_INTERPRETATION_TOTAL_DAILY_CENTS', 500),
        },
      });
    },
  );
}
