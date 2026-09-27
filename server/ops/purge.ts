/**
 * Server-side half of a purge (#308): a deny-list of already-erased entities, and the
 * real erasure of their already-stored rows the moment a purge marker itself lands.
 *
 * A deliberate, narrow exception to ADR 0002's "opaque relay" framing, in the same
 * category `deletion-impact.ts` and `corpus_overrides` already are: at push time
 * `server/ops/routes.ts` already holds each op's *plaintext* in hand, transiently, right
 * before encrypting it for storage, so detecting a purge marker there costs nothing
 * beyond a `JSON.parse` of bytes already in memory — no new decryption capability.
 * Erasing rows already written to disk, though, does need to decrypt at-rest ciphertext,
 * exactly as `deletion-impact.ts`'s preview already does.
 */
import type { Database } from '../db.ts';
import { decryptPayload } from './crypto.ts';

export interface OpBody {
  readonly entity: string;
  readonly entityId: string;
  readonly field: string;
  readonly value: unknown;
}

/**
 * Mirrors `src/store/fold.ts`'s `PURGED_FIELD`. Duplicated rather than imported — this
 * module reads the *shape* of an op's plaintext body, the one exception ADR 0002 makes
 * for this file, but it still has no business importing the client's domain module for
 * it, the same reasoning `server/corpus-overrides.ts` gives for duplicating its own
 * literal unions instead of importing `src/interpretation/schema.ts`.
 */
const PURGED_FIELD = 'purged';

/** Parses an op's plaintext body just enough to check for a purge, nothing more. */
export function parseOpBody(plaintext: Buffer): OpBody | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const { entity, entityId, field, value } = parsed as Record<string, unknown>;
  if (typeof entity !== 'string' || entity === '') return undefined;
  if (typeof entityId !== 'string' || entityId === '') return undefined;
  if (typeof field !== 'string' || field === '') return undefined;
  return { entity, entityId, field, value };
}

export function isPurgeMarker(body: OpBody): boolean {
  return body.field === PURGED_FIELD && body.value === true;
}

export function isEntityPurged(db: Database, userId: string, entity: string, entityId: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM purged_entities WHERE user_id = ? AND entity = ? AND entity_id = ?')
    .get(userId, entity, entityId);
  return row !== undefined;
}

interface PayloadRow {
  readonly seq: number;
  readonly hlc: string;
  readonly payload: Buffer;
  readonly iv: Buffer | null;
}

/**
 * Records `(entity, entityId)` as permanently purged for this user, then erases every
 * already-stored row naming it — except the purge marker's own row (matched by `hlc`),
 * which must survive so a future pull still tells every device "this is gone".
 *
 * Not `SCAN_LIMIT`-bounded like `deletion-impact.ts`'s preview: that scan is a best-effort
 * estimate shown to a human, but this one has to be complete or a stale row could survive
 * and resurrect on a later pull. `MAX_OPS_PER_USER` (`server/ops/routes.ts`) already bounds
 * one user's table to a size this can afford to scan in full.
 */
export function recordPurgeAndErase(
  db: Database,
  userId: string,
  entity: string,
  entityId: string,
  purgedAt: string,
  markerHlc: string,
  key: Buffer,
): void {
  db.prepare(
    'INSERT INTO purged_entities (user_id, entity, entity_id, purged_at) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT (user_id, entity, entity_id) DO NOTHING',
  ).run(userId, entity, entityId, purgedAt);

  const rows = db
    .prepare('SELECT seq, hlc, payload, iv FROM ops WHERE user_id = ?')
    .all(userId) as unknown as PayloadRow[];
  const del = db.prepare('DELETE FROM ops WHERE seq = ?');
  for (const row of rows) {
    if (row.hlc === markerHlc || !row.iv) continue;
    let body: OpBody | undefined;
    try {
      body = parseOpBody(decryptPayload(row.payload, row.iv, key));
    } catch {
      continue;
    }
    if (body?.entity === entity && body.entityId === entityId) del.run(row.seq);
  }
}
