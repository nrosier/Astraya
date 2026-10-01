/**
 * Thin `fetch()` wrappers matching `server/auth/admin-routes.ts` exactly, one function
 * per route. Same shape as `auth-client.ts`: nothing here interprets a response beyond
 * its own shape, and every rejection carries the server's own message.
 */
import type { CorpusTier, Locale, PersonaId } from '../interpretation/schema.js';

/** Mirrors `server/auth/admin-routes.ts`'s `AdminUser` shape. */
export interface AdminUser {
  readonly id: string;
  readonly username: string;
  readonly isAdmin: boolean;
  readonly createdAt: string;
  readonly disabledAt: string | null;
  readonly lastSeenAt: string | null;
}

/** Mirrors `server/ops/deletion-impact.ts`'s `DeletionImpact`. */
export type DeletionImpact =
  | { readonly kind: 'counted'; readonly people: number; readonly charts: number }
  | { readonly kind: 'approximate'; readonly opRows: number };

/** Thrown for a request the server actively rejected (not an admin, last-admin guard, ...). */
export class AdminError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminError';
    this.status = status;
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    /* fall through to the generic message below */
  }
  return `Request failed with status ${String(response.status)}`;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new AdminError(await errorMessage(response), response.status);
  return (await response.json()) as T;
}

export async function listUsers(): Promise<readonly AdminUser[]> {
  const { users } = await call<{ users: readonly AdminUser[] }>('/api/admin/users');
  return users;
}

export async function createUser(
  username: string,
  isAdmin?: boolean,
): Promise<{ user: AdminUser; setPasswordUrl: string }> {
  return call('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(isAdmin === undefined ? { username } : { username, isAdmin }),
  });
}

export async function resetPassword(id: string): Promise<{ user: AdminUser; setPasswordUrl: string }> {
  return call(`/api/admin/users/${id}/reset-password`, { method: 'POST' });
}

export async function disableUser(id: string): Promise<AdminUser> {
  const { user } = await call<{ user: AdminUser }>(`/api/admin/users/${id}/disable`, { method: 'POST' });
  return user;
}

export async function enableUser(id: string): Promise<AdminUser> {
  const { user } = await call<{ user: AdminUser }>(`/api/admin/users/${id}/enable`, { method: 'POST' });
  return user;
}

export async function promoteUser(id: string): Promise<AdminUser> {
  const { user } = await call<{ user: AdminUser }>(`/api/admin/users/${id}/promote`, { method: 'POST' });
  return user;
}

export async function demoteUser(id: string): Promise<AdminUser> {
  const { user } = await call<{ user: AdminUser }>(`/api/admin/users/${id}/demote`, { method: 'POST' });
  return user;
}

/** `POST` for a read, matching the route — see its comment in `server/auth/admin-routes.ts`. */
export async function getDeletionImpact(id: string): Promise<DeletionImpact> {
  return call(`/api/admin/users/${id}/deletion-impact`, { method: 'POST' });
}

export async function deleteUser(id: string): Promise<void> {
  await call(`/api/admin/users/${id}`, { method: 'DELETE' });
}

/** Mirrors `server/corpus-overrides.ts`'s `CorpusOverride` shape (#292). */
export interface CorpusOverride {
  readonly id: string;
  readonly key: string;
  readonly locale: Locale;
  /** Absent means the neutral, persona-agnostic override. */
  readonly persona: PersonaId | undefined;
  readonly text: string;
  readonly tier: CorpusTier;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly updatedByUserId: string;
  readonly updatedByUsername: string;
}

export interface UpsertCorpusOverrideParams {
  readonly key: string;
  readonly locale: Locale;
  readonly persona?: PersonaId;
  readonly text: string;
  readonly tier: CorpusTier;
  readonly tags: readonly string[];
}

export async function listCorpusOverrides(locale?: Locale): Promise<readonly CorpusOverride[]> {
  const query = locale !== undefined ? `?locale=${locale}` : '';
  const { overrides } = await call<{ overrides: readonly CorpusOverride[] }>(`/api/admin/corpus-overrides${query}`);
  return overrides;
}

export async function upsertCorpusOverride(params: UpsertCorpusOverrideParams): Promise<CorpusOverride> {
  const { override } = await call<{ override: CorpusOverride }>('/api/admin/corpus-overrides', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return override;
}

export async function deleteCorpusOverride(id: string): Promise<void> {
  await call(`/api/admin/corpus-overrides/${id}`, { method: 'DELETE' });
}

/** `server/corpus-overrides-routes.ts`'s export route returns the file body directly, not `{ ... }`-wrapped JSON — a `Blob`, not `call<T>`, is the right shape for a client-side download. */
export async function exportCorpusOverrides(locale?: Locale): Promise<Blob> {
  const query = locale !== undefined ? `?locale=${locale}` : '';
  const response = await fetch(`/api/admin/corpus-overrides/export${query}`);
  if (!response.ok) throw new AdminError(await errorMessage(response), response.status);
  return response.blob();
}

/** Mirrors `server/corpus-candidates.ts`'s `CandidateSource`/`TriageSignal`/`CorpusCandidate` (#370). */
export type CandidateSource = 'classical-seed' | 'llm-fill';
export type TriageSignal = 'match' | 'mismatch' | 'no-baseline';
export type CandidateStatus = 'pending' | 'accepted' | 'rejected';

export interface CorpusCandidate {
  readonly id: string;
  readonly key: string;
  readonly locale: Locale;
  /** Absent means the neutral, persona-agnostic candidate. */
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

export async function listCorpusCandidates(
  locale?: Locale,
  status?: CandidateStatus,
): Promise<readonly CorpusCandidate[]> {
  const params = new URLSearchParams();
  if (locale !== undefined) params.set('locale', locale);
  if (status !== undefined) params.set('status', status);
  const query = params.size > 0 ? `?${params.toString()}` : '';
  const { candidates } = await call<{ candidates: readonly CorpusCandidate[] }>(`/api/admin/corpus-candidates${query}`);
  return candidates;
}

export interface DecideCorpusCandidatesResult {
  readonly decided: readonly string[];
  readonly missing: readonly string[];
}

export async function decideCorpusCandidates(
  ids: readonly string[],
  decision: 'accept' | 'reject',
): Promise<DecideCorpusCandidatesResult> {
  return call('/api/admin/corpus-candidates', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, decision }),
  });
}

/** Mirrors `server/interpretation/usage.ts`'s `UserUsageSummary`, plus the last-24h figure the route adds alongside it. */
export interface InterpretationUsageSummary {
  readonly userId: string;
  readonly username: string;
  readonly requestCount: number;
  readonly promptTokens: number;
  readonly outputTokens: number;
  readonly costCents: number;
  readonly lastUsedAt: string;
  readonly costCentsLast24h: number;
}

export interface InterpretationUsageReport {
  readonly users: readonly InterpretationUsageSummary[];
  readonly totalCostCentsLast24h: number;
  readonly caps: { readonly userDailyCapCents: number; readonly totalDailyCapCents: number };
}

/** Admin-only Tier 2 (#360) cost visibility (#382) — never the generated interpretation text itself, only usage/cost. */
export async function getInterpretationUsage(): Promise<InterpretationUsageReport> {
  return call('/api/admin/interpretation-usage');
}
