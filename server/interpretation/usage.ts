/**
 * Cost accounting for Tier 2 (#360), against migration 8's
 * `interpretation_usage` table (`server/db.ts`) — one row per successful
 * model call. Backs the two real dollar caps `server/interpretation-routes.ts`
 * checks before every call, on top of the per-user-per-hour request-count
 * limit: a request-count limit alone doesn't bound spend if a single call's
 * cost varies with prompt/output length.
 */
import type { Database } from '../db.ts';

export function recordUsage(
  db: Database,
  params: {
    readonly userId: string;
    readonly promptTokens: number;
    readonly outputTokens: number;
    readonly costCents: number;
  },
): void {
  db.prepare(
    'INSERT INTO interpretation_usage (user_id, prompt_tokens, output_tokens, cost_cents, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(params.userId, params.promptTokens, params.outputTokens, params.costCents, new Date().toISOString());
}

function sinceIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/** Total cost, in cents, this user has incurred in the last 24 hours. */
export function userCostCentsSince(db: Database, userId: string, hours = 24): number {
  const row = db
    .prepare(
      'SELECT COALESCE(SUM(cost_cents), 0) AS total FROM interpretation_usage WHERE user_id = ? AND created_at >= ?',
    )
    .get(userId, sinceIso(hours)) as { total: number };
  return row.total;
}

/** Total cost, in cents, across every user in the last 24 hours. */
export function totalCostCentsSince(db: Database, hours = 24): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(cost_cents), 0) AS total FROM interpretation_usage WHERE created_at >= ?')
    .get(sinceIso(hours)) as { total: number };
  return row.total;
}
