/**
 * Admin review of bulk-generated corpus candidates (#370): list/filter the pending queue,
 * import a fresh batch, and accept/reject one or many at once. Unlike
 * `corpus-overrides-routes.ts`, there is no public route here at all — nothing in
 * `corpus_candidates` is visible to anyone until an admin accepts it (see `server/db.ts`
 * migration 9's own comment), so every route below is `requireAdmin`-gated.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from './db.ts';
import type { User } from './auth/identity.ts';
import {
  CANDIDATE_SOURCES,
  LOCALES,
  PERSONA_IDS,
  TIERS,
  TRIAGE_SIGNALS,
  CANDIDATE_STATUSES,
  decideCorpusCandidates,
  importCorpusCandidates,
  listCorpusCandidates,
  type CandidateSource,
  type CandidateStatus,
  type CorpusTier,
  type Locale,
  type PersonaId,
  type TriageSignal,
} from './corpus-candidates.ts';
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

function isSource(value: unknown): value is CandidateSource {
  return typeof value === 'string' && (CANDIDATE_SOURCES as readonly string[]).includes(value);
}

function isTriageSignal(value: unknown): value is TriageSignal {
  return typeof value === 'string' && (TRIAGE_SIGNALS as readonly string[]).includes(value);
}

function isStatus(value: unknown): value is CandidateStatus {
  return typeof value === 'string' && (CANDIDATE_STATUSES as readonly string[]).includes(value);
}

/** `requireAdmin` is a preHandler on every route below, so by the time a handler body runs this cannot be unset. */
function authenticatedUser(request: FastifyRequest): User {
  if (!request.user) throw new Error('requireAdmin preHandler did not run before this handler.');
  return request.user;
}

interface ImportBodyEntry {
  readonly key?: unknown;
  readonly locale?: unknown;
  readonly persona?: unknown;
  readonly text?: unknown;
  readonly tier?: unknown;
  readonly tags?: unknown;
  readonly source?: unknown;
  readonly triageSignal?: unknown;
  readonly triageScore?: unknown;
}

interface ImportBody {
  readonly candidates?: unknown;
}

interface DecideBody {
  readonly ids?: unknown;
  readonly decision?: unknown;
}

// A generation batch covers at most a few thousand placements (a full persona-scope chunk is
// 2,742 entries per #292's own sizing) — generous ceiling against a request padded to inflate
// server-side work, same reasoning as `interpretation-routes.ts`'s `MAX_BODIES`/`MAX_ASPECTS`.
const MAX_IMPORT_BATCH = 5_000;
const MAX_DECIDE_BATCH = 500;

export function registerCorpusCandidateRoutes(app: FastifyInstance, db: Database): void {
  app.get<{ Querystring: { locale?: string; status?: string } }>(
    '/api/admin/corpus-candidates',
    { preHandler: requireAdmin(db), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { locale, status } = request.query;
      if (locale !== undefined && !isLocale(locale)) {
        return reply.code(400).send({ error: `locale must be one of ${LOCALES.join(', ')}` });
      }
      if (status !== undefined && !isStatus(status)) {
        return reply.code(400).send({ error: `status must be one of ${CANDIDATE_STATUSES.join(', ')}` });
      }
      const candidates = listCorpusCandidates(db, {
        ...(locale !== undefined ? { locale } : {}),
        // Defaults to 'pending': the queue an admin actually wants to work through. A candidate
        // that was already accepted or rejected no longer exists as a row at all (both
        // decisions delete it — see `decideCorpusCandidates`'s own doc comment), so `status`
        // only ever matters as a way to ask for something other than the default.
        status: status ?? 'pending',
      });
      return reply.send({ candidates });
    },
  );

  app.post<{ Body: ImportBody }>(
    '/api/admin/corpus-candidates/import',
    { preHandler: requireAdmin(db), config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { candidates } = request.body;
      if (!Array.isArray(candidates) || candidates.length === 0) {
        return reply.code(400).send({ error: 'candidates must be a non-empty array' });
      }
      if (candidates.length > MAX_IMPORT_BATCH) {
        return reply.code(400).send({ error: `candidates must not exceed ${String(MAX_IMPORT_BATCH)} entries` });
      }

      const validated: {
        key: string;
        locale: Locale;
        persona?: PersonaId;
        text: string;
        tier: CorpusTier;
        tags: readonly string[];
        source: CandidateSource;
        triageSignal?: TriageSignal;
        triageScore?: number;
      }[] = [];

      for (const [index, raw] of candidates.entries()) {
        const entry = raw as ImportBodyEntry;
        const { key, locale, persona, text, tier, tags, source, triageSignal, triageScore } = entry;
        const at = (message: string): string => `candidates[${String(index)}]: ${message}`;
        if (typeof key !== 'string' || key === '') return reply.code(400).send({ error: at('key is required') });
        if (!isLocale(locale))
          return reply.code(400).send({ error: at(`locale must be one of ${LOCALES.join(', ')}`) });
        if (persona !== undefined && !isPersonaId(persona)) {
          return reply.code(400).send({ error: at(`persona must be one of ${PERSONA_IDS.join(', ')}`) });
        }
        if (typeof text !== 'string' || text === '') return reply.code(400).send({ error: at('text is required') });
        if (!isTier(tier)) return reply.code(400).send({ error: at(`tier must be one of ${TIERS.join(', ')}`) });
        if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string')) {
          return reply.code(400).send({ error: at('tags must be an array of strings') });
        }
        if (!isSource(source))
          return reply.code(400).send({ error: at(`source must be one of ${CANDIDATE_SOURCES.join(', ')}`) });
        if (triageSignal !== undefined && !isTriageSignal(triageSignal)) {
          return reply.code(400).send({ error: at(`triageSignal must be one of ${TRIAGE_SIGNALS.join(', ')}`) });
        }
        if (triageScore !== undefined && typeof triageScore !== 'number') {
          return reply.code(400).send({ error: at('triageScore must be a number') });
        }
        validated.push({
          key,
          locale,
          ...(persona !== undefined ? { persona } : {}),
          text,
          tier,
          tags,
          source,
          ...(triageSignal !== undefined ? { triageSignal } : {}),
          ...(triageScore !== undefined ? { triageScore } : {}),
        });
      }

      const imported = importCorpusCandidates(db, validated);
      return reply.send({ imported });
    },
  );

  app.patch<{ Body: DecideBody }>(
    '/api/admin/corpus-candidates',
    { preHandler: requireAdmin(db), config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { ids, decision } = request.body;
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string')) {
        return reply.code(400).send({ error: 'ids must be a non-empty array of strings' });
      }
      if (ids.length > MAX_DECIDE_BATCH) {
        return reply.code(400).send({ error: `ids must not exceed ${String(MAX_DECIDE_BATCH)} entries` });
      }
      if (decision !== 'accept' && decision !== 'reject') {
        return reply.code(400).send({ error: "decision must be 'accept' or 'reject'" });
      }

      // Same content-quality gate `corpus-overrides-routes.ts`'s upsert route already runs on
      // an admin's own hand-typed correction (#354) — a machine-generated candidate becoming a
      // live override warrants at least the same scrutiny, arguably more. Checked against every
      // still-pending candidate named in the request *before* any of them are decided, so a
      // batch either fully succeeds or fails closed rather than partially committing.
      if (decision === 'accept') {
        const pending = listCorpusCandidates(db, { status: 'pending' });
        const byId = new Map(pending.map((candidate) => [candidate.id, candidate]));
        for (const id of ids) {
          const candidate = byId.get(id);
          if (candidate === undefined) continue; // reported as `missing` by decideCorpusCandidates below
          const draft: CorpusEntry = {
            key: candidate.key,
            locale: candidate.locale,
            text: candidate.text,
            tier: candidate.tier,
            tags: candidate.tags,
            provenance: { source: 'hand-written' },
            ...(candidate.persona !== undefined ? { persona: candidate.persona } : {}),
          };
          const lintIssues = lintEntry(draft);
          if (lintIssues.length > 0) {
            return reply.code(400).send({
              error: `Content-quality check failed for candidate ${candidate.key}: ${lintIssues.map((issue) => issue.message).join('; ')}`,
            });
          }
        }
      }

      const result = decideCorpusCandidates(db, { ids, decision, decidedByUserId: authenticatedUser(request).id });
      return reply.send(result);
    },
  );
}
