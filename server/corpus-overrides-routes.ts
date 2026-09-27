/**
 * Admin corpus corrections (#292): browse/edit/export overrides to committed
 * interpretation-corpus entries, plus the one public route the client merges
 * into the runtime corpus before rendering a report.
 *
 * The public `GET /api/corpus-overrides/:locale` route is deliberate, unlike
 * every other route in this file: an override only ever replaces *visible
 * report text* that every visitor already receives from the equally-public
 * static corpus chunks (`public/corpus/`), so gating it behind a session
 * would mean anonymous/local-only use — this app's primary mode — never sees
 * a correction. Writes stay `requireAdmin`, matching every other admin route.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from './db.ts';
import type { User } from './auth/identity.ts';
import {
  LOCALES,
  PERSONA_IDS,
  TIERS,
  deleteCorpusOverride,
  listCorpusOverrides,
  toCorpusEntry,
  upsertCorpusOverride,
  type Locale,
  type PersonaId,
  type CorpusTier,
} from './corpus-overrides.ts';
import { requireAdmin } from './auth/identity.ts';
import { lintEntry } from '../src/interpretation/lint.ts';
import type { CorpusEntry } from '../src/interpretation/schema.ts';

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

function isPersonaId(value: unknown): value is PersonaId {
  return typeof value === 'string' && (PERSONA_IDS as readonly string[]).includes(value);
}

function isTier(value: unknown): value is CorpusTier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

/** `requireAdmin` is a preHandler on every write route below, so by the time a handler body runs this cannot be unset. */
function authenticatedUser(request: FastifyRequest): User {
  if (!request.user) throw new Error('requireAdmin preHandler did not run before this handler.');
  return request.user;
}

interface UpsertBody {
  readonly key?: unknown;
  readonly locale?: unknown;
  readonly persona?: unknown;
  readonly text?: unknown;
  readonly tier?: unknown;
  readonly tags?: unknown;
}

export function registerCorpusOverrideRoutes(app: FastifyInstance, db: Database): void {
  app.get<{ Params: { locale: string } }>(
    '/api/corpus-overrides/:locale',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!isLocale(request.params.locale)) {
        return reply.code(400).send({ error: `locale must be one of ${LOCALES.join(', ')}` });
      }
      const overrides = listCorpusOverrides(db, request.params.locale);
      return reply.send({ entries: overrides.map((override) => toCorpusEntry(override, { includeReviewer: false })) });
    },
  );

  app.get<{ Querystring: { locale?: string } }>(
    '/api/admin/corpus-overrides',
    { preHandler: requireAdmin(db), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { locale } = request.query;
      if (locale !== undefined && !isLocale(locale)) {
        return reply.code(400).send({ error: `locale must be one of ${LOCALES.join(', ')}` });
      }
      const overrides = listCorpusOverrides(db, locale);
      return reply.send({ overrides });
    },
  );

  app.put<{ Body: UpsertBody }>(
    '/api/admin/corpus-overrides',
    { preHandler: requireAdmin(db), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { key, locale, persona, text, tier, tags } = request.body;
      if (typeof key !== 'string' || key === '') return reply.code(400).send({ error: 'key is required' });
      if (!isLocale(locale)) return reply.code(400).send({ error: `locale must be one of ${LOCALES.join(', ')}` });
      if (persona !== undefined && !isPersonaId(persona)) {
        return reply.code(400).send({ error: `persona must be one of ${PERSONA_IDS.join(', ')}` });
      }
      if (typeof text !== 'string' || text === '') return reply.code(400).send({ error: 'text is required' });
      if (!isTier(tier)) return reply.code(400).send({ error: `tier must be one of ${TIERS.join(', ')}` });
      if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) {
        return reply.code(400).send({ error: 'tags must be an array of strings' });
      }

      // `lintEntry` (#354) is the same content-quality gate `tools/corpus-gen` already runs
      // on every machine-produced entry before it ships — length bounds, fatalistic phrasing,
      // medical/legal/financial claims, gendered pronouns. An admin's hand-typed correction
      // got none of that until now; `provenance`/`persona` don't affect any of those rules,
      // so a minimal stand-in entry is enough to lint against before it's ever stored.
      const candidate: CorpusEntry = {
        key,
        locale,
        text,
        tier,
        tags,
        provenance: { source: 'hand-written' },
        ...(persona !== undefined ? { persona } : {}),
      };
      const lintIssues = lintEntry(candidate);
      if (lintIssues.length > 0) {
        return reply
          .code(400)
          .send({ error: `Content-quality check failed: ${lintIssues.map((issue) => issue.message).join('; ')}` });
      }

      const override = upsertCorpusOverride(db, {
        key,
        locale,
        ...(persona !== undefined ? { persona } : {}),
        text,
        tier,
        tags,
        updatedByUserId: authenticatedUser(request).id,
      });
      return reply.send({ override });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/corpus-overrides/:id',
    { preHandler: requireAdmin(db), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const deleted = deleteCorpusOverride(db, request.params.id);
      if (!deleted) return reply.code(404).send({ error: 'No such override' });
      return reply.send({ ok: true });
    },
  );

  app.get<{ Querystring: { locale?: string } }>(
    '/api/admin/corpus-overrides/export',
    { preHandler: requireAdmin(db), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { locale } = request.query;
      if (locale !== undefined && !isLocale(locale)) {
        return reply.code(400).send({ error: `locale must be one of ${LOCALES.join(', ')}` });
      }
      const entries = listCorpusOverrides(db, locale).map((override) => toCorpusEntry(override));
      const filename = `astraya-corpus-overrides-${locale ?? 'all'}-${new Date().toISOString().slice(0, 10)}.json`;
      return reply
        .header('Content-Type', 'application/json')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(JSON.stringify(entries, null, 2));
    },
  );
}
