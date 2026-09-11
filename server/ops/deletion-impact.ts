/**
 * A preview of what deleting a user's operation log would take with it (#135) — shown
 * to an admin before a delete is confirmed, never a route in its own right for browsing
 * another user's data. See the PR description for why this is a deliberate, narrow
 * exception to ADR 0002's "opaque relay" framing rather than a new capability: the relay
 * already decrypts a payload in the ordinary pull path (to re-encrypt-at-rest
 * transparently for the same owning client); this is a human explicitly asking for that
 * same decryption once, for one target user, for an irreversible-consequence check.
 */
import type { Database } from '../db.ts';
import { decryptPayload } from './crypto.ts';

export type DeletionImpact =
  | { readonly kind: 'counted'; readonly people: number; readonly charts: number }
  | { readonly kind: 'approximate'; readonly opRows: number };

interface PayloadRow {
  readonly payload: Buffer;
  readonly iv: Buffer | null;
}

/** Mirrors `src/store/fold.ts`'s `KNOWN_ENTITIES` — the only two entities anything writes today. */
const KNOWN_ENTITIES = ['person', 'chart'] as const;

/**
 * `key` is whatever `loadEncryptionKey()` returns *right now* — if the relay isn't
 * configured on this deployment (or was unconfigured after these rows were written),
 * there is nothing to decrypt, so this falls back to an approximate row count rather
 * than crashing or lying with a `0`.
 */
export function previewDeletionImpact(db: Database, userId: string, key: Buffer | null): DeletionImpact {
  const rows = db.prepare('SELECT payload, iv FROM ops WHERE user_id = ?').all(userId) as unknown as PayloadRow[];

  if (!key) return { kind: 'approximate', opRows: rows.length };

  const seen = new Map<string, Set<string>>(KNOWN_ENTITIES.map((entity) => [entity, new Set<string>()]));
  for (const row of rows) {
    if (!row.iv) continue;
    let body: unknown;
    try {
      body = JSON.parse(decryptPayload(row.payload, row.iv, key).toString('utf8'));
    } catch {
      continue;
    }
    if (typeof body !== 'object' || body === null) continue;
    const { entity, entityId } = body as Record<string, unknown>;
    if (typeof entity !== 'string' || typeof entityId !== 'string') continue;
    seen.get(entity)?.add(entityId);
  }

  return { kind: 'counted', people: seen.get('person')?.size ?? 0, charts: seen.get('chart')?.size ?? 0 };
}
