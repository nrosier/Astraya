/**
 * Persists a Tier 2 (#360) generation's own output so a user can reopen it later without
 * regenerating — #392. `sections_json` is encrypted at rest the same way `ops.payload` is
 * (`server/ops/crypto.ts`, AES-256-GCM) — this table holds actual generated interpretation
 * prose, unlike `interpretation_usage` (migration 8), which by design never does.
 */
import { randomUUID } from 'node:crypto';
import type { Database } from '../db.ts';
import { CURRENT_KEY_VERSION, decryptPayload, encryptPayload } from '../ops/crypto.ts';
import type { Tier2Section } from './llm-client.ts';

export interface InterpretationResultSummary {
  readonly id: string;
  readonly mode: string;
  readonly locale: string;
  readonly createdAt: string;
}

export interface InterpretationResultDetail extends InterpretationResultSummary {
  readonly sections: readonly Tier2Section[];
}

/** Encrypts and stores one generation's sections. `key` is the caller's already-loaded `ASTRAYA_ENCRYPTION_KEY` — never called when that's unset (see `interpretation-routes.ts`). */
export function saveInterpretationResult(
  db: Database,
  params: {
    readonly userId: string;
    readonly mode: string;
    readonly locale: string;
    readonly sections: readonly Tier2Section[];
  },
  key: Buffer,
): string {
  const id = randomUUID();
  const plaintext = Buffer.from(JSON.stringify(params.sections), 'utf8');
  const { ciphertext, iv } = encryptPayload(plaintext, key);
  db.prepare(
    'INSERT INTO interpretation_results (id, user_id, mode, locale, sections_json, key_version, iv, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, params.userId, params.mode, params.locale, ciphertext, CURRENT_KEY_VERSION, iv, new Date().toISOString());
  return id;
}

interface SummaryRow {
  readonly id: string;
  readonly mode: string;
  readonly locale: string;
  readonly created_at: string;
}

/** Metadata only, newest first — never decrypts, so this works even if the server's key has since been rotated away (#340) or removed. */
export function listInterpretationResults(db: Database, userId: string): readonly InterpretationResultSummary[] {
  const rows = db
    .prepare(
      'SELECT id, mode, locale, created_at FROM interpretation_results WHERE user_id = ? ORDER BY created_at DESC',
    )
    .all(userId) as unknown as SummaryRow[];
  return rows.map((row) => ({ id: row.id, mode: row.mode, locale: row.locale, createdAt: row.created_at }));
}

interface DetailRow extends SummaryRow {
  readonly sections_json: Buffer;
  readonly iv: Buffer;
}

/** `undefined` when no such result exists for this user (never leaks whether it exists for a *different* user — the query itself is scoped to `userId`). Throws if decryption fails (a tampered row, or `key` doesn't match what encrypted it) — the same fail-closed behavior `decryptPayload` already guarantees for `ops.payload`. */
export function getInterpretationResult(
  db: Database,
  userId: string,
  id: string,
  key: Buffer,
): InterpretationResultDetail | undefined {
  const row = db
    .prepare(
      'SELECT id, mode, locale, sections_json, iv, created_at FROM interpretation_results WHERE user_id = ? AND id = ?',
    )
    .get(userId, id) as DetailRow | undefined;
  if (row === undefined) return undefined;
  const plaintext = decryptPayload(row.sections_json, row.iv, key);
  const sections = JSON.parse(plaintext.toString('utf8')) as readonly Tier2Section[];
  return { id: row.id, mode: row.mode, locale: row.locale, createdAt: row.created_at, sections };
}
