/**
 * A pending-candidate queue for bulk-generated corpus text (#370), upstream of #292's
 * `corpus_overrides` (`server/corpus-overrides.ts`) — CRUD against the `corpus_candidates`
 * table (`server/db.ts` migration 9). See that migration's own comment for why this is a
 * separate table rather than an extra column on `corpus_overrides`: a candidate must stay
 * invisible to every reader until an admin accepts it, unlike an override, which is live the
 * instant it's saved.
 *
 * Only `import type` from `src/interpretation/schema.ts`, for the same reason
 * `corpus-overrides.ts` does — see that file's own doc comment. The literal unions below
 * duplicate `schema.ts`'s real exports for the same reason `corpus-overrides.ts`'s do;
 * `test/server-corpus-overrides.test.ts` already asserts those arrays stay in sync, and
 * `test/server-corpus-candidates.test.ts` asserts these do too.
 */
import { randomUUID } from 'node:crypto';
import type { Database } from './db.ts';
import { upsertCorpusOverride } from './corpus-overrides.ts';

export const LOCALES = ['en', 'nl'] as const;
export type Locale = (typeof LOCALES)[number];

export const TIERS = ['core', 'notable', 'nuance'] as const;
export type CorpusTier = (typeof TIERS)[number];

export const PERSONA_IDS = ['traditionalist', 'big_sister', 'cynic', 'mystic', 'pragmatist'] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];

/** Where a candidate's text came from — not `CorpusProvenance.source` (`schema.ts`): that
 * describes a *shipped* entry's origin, this describes an unreviewed one still in the queue. */
export const CANDIDATE_SOURCES = ['classical-seed', 'llm-fill'] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

/** `null` means not yet checked; `'no-baseline'` is a modern-technique candidate with nothing
 * classical to check against (#359's "fact-grounding, not tradition-matching" signal instead). */
export const TRIAGE_SIGNALS = ['match', 'mismatch', 'no-baseline'] as const;
export type TriageSignal = (typeof TRIAGE_SIGNALS)[number];

export const CANDIDATE_STATUSES = ['pending', 'accepted', 'rejected'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export interface CorpusCandidate {
  readonly id: string;
  readonly key: string;
  readonly locale: Locale;
  readonly persona: PersonaId | undefined;
  readonly text: string;
  readonly tier: CorpusTier;
  readonly tags: readonly string[];
  readonly source: CandidateSource;
  readonly triageSignal: TriageSignal | undefined;
  readonly triageScore: number | undefined;
  readonly status: CandidateStatus;
  readonly createdAt: string;
  readonly decidedAt: string | undefined;
  readonly decidedByUsername: string | undefined;
}

interface CorpusCandidateRow {
  readonly id: string;
  readonly key: string;
  readonly locale: string;
  readonly persona: string;
  readonly text: string;
  readonly tier: string;
  readonly tags: string;
  readonly source: string;
  readonly triage_signal: string | null;
  readonly triage_score: number | null;
  readonly status: string;
  readonly created_at: string;
  readonly decided_at: string | null;
  readonly decided_by_username: string | null;
}

function toCorpusCandidate(row: CorpusCandidateRow): CorpusCandidate {
  return {
    id: row.id,
    key: row.key,
    locale: row.locale as Locale,
    persona: row.persona === '' ? undefined : (row.persona as PersonaId),
    text: row.text,
    tier: row.tier as CorpusTier,
    tags: JSON.parse(row.tags) as readonly string[],
    source: row.source as CandidateSource,
    triageSignal: row.triage_signal === null ? undefined : (row.triage_signal as TriageSignal),
    triageScore: row.triage_score ?? undefined,
    status: row.status as CandidateStatus,
    createdAt: row.created_at,
    decidedAt: row.decided_at ?? undefined,
    decidedByUsername: row.decided_by_username ?? undefined,
  };
}

const SELECT_WITH_USERNAME = `
  SELECT corpus_candidates.*, users.username AS decided_by_username
  FROM corpus_candidates LEFT JOIN users ON users.id = corpus_candidates.decided_by
`;

export interface ListCorpusCandidatesFilter {
  readonly locale?: Locale;
  readonly status?: CandidateStatus;
}

export function listCorpusCandidates(
  db: Database,
  filter: ListCorpusCandidatesFilter = {},
): readonly CorpusCandidate[] {
  const rows = db
    .prepare(
      `${SELECT_WITH_USERNAME}
       WHERE (?1 IS NULL OR corpus_candidates.locale = ?1) AND (?2 IS NULL OR corpus_candidates.status = ?2)
       ORDER BY corpus_candidates.triage_score IS NULL, corpus_candidates.triage_score ASC, corpus_candidates.created_at ASC`,
    )
    .all(filter.locale ?? null, filter.status ?? null) as unknown as CorpusCandidateRow[];
  return rows.map(toCorpusCandidate);
}

export interface ImportCorpusCandidateParams {
  readonly key: string;
  readonly locale: Locale;
  readonly persona?: PersonaId;
  readonly text: string;
  readonly tier: CorpusTier;
  readonly tags: readonly string[];
  readonly source: CandidateSource;
  readonly triageSignal?: TriageSignal;
  readonly triageScore?: number;
}

/**
 * Bulk-imports generated candidates, idempotently: re-running the same generation batch
 * against an already-imported (still-pending) candidate updates it in place rather than
 * duplicating it, via the same `(key, locale, persona, source)` identity the unique index
 * enforces. A candidate already decided (`accepted`/`rejected`) has already been deleted by
 * `decideCorpusCandidates` below, so it never conflicts here — a re-import after a decision
 * inserts a fresh pending row rather than resurrecting the old one.
 */
export function importCorpusCandidates(db: Database, candidates: readonly ImportCorpusCandidateParams[]): number {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO corpus_candidates
       (id, key, locale, persona, text, tier, tags, source, triage_signal, triage_score, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
     ON CONFLICT(key, locale, persona, source) DO UPDATE SET
       text = excluded.text, tier = excluded.tier, tags = excluded.tags,
       triage_signal = excluded.triage_signal, triage_score = excluded.triage_score`,
  );
  for (const candidate of candidates) {
    insert.run(
      randomUUID(),
      candidate.key,
      candidate.locale,
      candidate.persona ?? '',
      candidate.text,
      candidate.tier,
      JSON.stringify(candidate.tags),
      candidate.source,
      candidate.triageSignal ?? null,
      candidate.triageScore ?? null,
      now,
    );
  }
  return candidates.length;
}

export interface DecideCorpusCandidatesParams {
  readonly ids: readonly string[];
  readonly decision: 'accept' | 'reject';
  readonly decidedByUserId: string;
}

export interface DecideCorpusCandidatesResult {
  /** Ids that existed, were still pending, and were decided. */
  readonly decided: readonly string[];
  /** Ids in the request that named no pending candidate (already decided, or never existed). */
  readonly missing: readonly string[];
}

/**
 * Accepting turns a candidate into a live override via the exact same `upsertCorpusOverride`
 * (`corpus-overrides.ts`) an admin's own hand-typed correction goes through — same immediate
 * visibility, same public read route, same export path. There is no second "how does text
 * become visible" mechanism to maintain. Rejecting and accepting both delete the candidate row
 * either way, matching #292's own resolved "latest-value-wins, no history table" audit
 * decision: `decided_at`/`decided_by` are read back before the delete so the caller can report
 * who did what, but nothing is kept once this returns.
 */
export function decideCorpusCandidates(
  db: Database,
  params: DecideCorpusCandidatesParams,
): DecideCorpusCandidatesResult {
  const decided: string[] = [];
  const missing: string[] = [];
  const selectPending = db.prepare(
    `${SELECT_WITH_USERNAME} WHERE corpus_candidates.id = ? AND corpus_candidates.status = 'pending'`,
  );
  const deleteById = db.prepare('DELETE FROM corpus_candidates WHERE id = ?');

  for (const id of params.ids) {
    const row = selectPending.get(id) as unknown as CorpusCandidateRow | undefined;
    if (row === undefined) {
      missing.push(id);
      continue;
    }
    if (params.decision === 'accept') {
      const candidate = toCorpusCandidate(row);
      upsertCorpusOverride(db, {
        key: candidate.key,
        locale: candidate.locale,
        ...(candidate.persona !== undefined ? { persona: candidate.persona } : {}),
        text: candidate.text,
        tier: candidate.tier,
        tags: candidate.tags,
        updatedByUserId: params.decidedByUserId,
      });
    }
    deleteById.run(id);
    decided.push(id);
  }
  return { decided, missing };
}
