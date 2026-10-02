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

export interface UserUsageSummary {
  readonly userId: string;
  readonly username: string;
  readonly requestCount: number;
  readonly promptTokens: number;
  readonly outputTokens: number;
  readonly costCents: number;
  readonly lastUsedAt: string;
}

/**
 * All-time usage totals per user who has made at least one call — an admin-only view
 * (#382) of the same table the two daily caps already check before every call. Only users
 * with usage are returned (an inner join, not a left join): a deployment with many accounts
 * and few Tier 2 users shouldn't render a wall of all-zero rows.
 */
export function usageByUser(db: Database): readonly UserUsageSummary[] {
  const rows = db
    .prepare(
      `SELECT users.id AS user_id, users.username, COUNT(*) AS request_count,
              SUM(interpretation_usage.prompt_tokens) AS prompt_tokens,
              SUM(interpretation_usage.output_tokens) AS output_tokens,
              SUM(interpretation_usage.cost_cents) AS cost_cents,
              MAX(interpretation_usage.created_at) AS last_used_at
       FROM interpretation_usage
       JOIN users ON users.id = interpretation_usage.user_id
       GROUP BY users.id
       ORDER BY cost_cents DESC`,
    )
    .all() as {
    user_id: string;
    username: string;
    request_count: number;
    prompt_tokens: number;
    output_tokens: number;
    cost_cents: number;
    last_used_at: string;
  }[];
  return rows.map((row) => ({
    userId: row.user_id,
    username: row.username,
    requestCount: row.request_count,
    promptTokens: row.prompt_tokens,
    outputTokens: row.output_tokens,
    costCents: row.cost_cents,
    lastUsedAt: row.last_used_at,
  }));
}

/** Cost in cents per user in the last `hours`, for comparing a user's recent spend against `ASTRAYA_INTERPRETATION_USER_DAILY_CENTS` without a per-user query loop. */
export function costCentsSinceByUser(db: Database, hours = 24): ReadonlyMap<string, number> {
  const rows = db
    .prepare(
      'SELECT user_id, COALESCE(SUM(cost_cents), 0) AS total FROM interpretation_usage WHERE created_at >= ? GROUP BY user_id',
    )
    .all(sinceIso(hours)) as { user_id: string; total: number }[];
  return new Map(rows.map((row) => [row.user_id, row.total]));
}
