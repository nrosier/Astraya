/**
 * The operation-relay endpoints (#102): append and pull against the opaque
 * `ops` log. The server never interprets a payload's contents (ADR 0002) — it
 * only assigns each one a sequence number, encrypts it at rest (#92), and scopes
 * every row to the authenticated user (#80).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../db.ts';
import { requireUser, type User } from '../auth/identity.ts';
import { decodeHlc, isHlc } from '../../src/store/hlc.ts';
import { CURRENT_KEY_VERSION, decryptPayload, encryptPayload, loadEncryptionKey } from './crypto.ts';
import { isEntityPurged, isPurgeMarker, parseOpBody, recordPurgeAndErase } from './purge.ts';

/** An HLC this far ahead of the server's own clock is quarantined (#105, #312). */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
/** Within the reject bound but still this far ahead: accepted, but logged, so a persistent offender is diagnosable. */
const SKEW_WARN_THRESHOLD_MS = 5 * 60 * 1000;

/** Bounds on a single request, so one client can't hand the server an unbounded array or an unbounded result set. */
const MAX_BATCH_SIZE = 500;
const MAX_PAGE_SIZE = 500;

/**
 * Row-count cap on one account's whole op log (#322). Generous for this app's
 * actual per-person/per-chart field-write volume — retention (deleting old
 * ops) is out of scope, since the op log is the only copy of history for
 * local-first sync.
 */
const MAX_OPS_PER_USER = 200_000;

/** Base64's own alphabet/padding, not a decode-and-hope: a malformed payload is rejected here as the 400 it is, rather than aborting the whole insert batch later (#320). */
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{4})?$/;

function isValidBase64(value: string): boolean {
  return BASE64_PATTERN.test(value);
}

interface OpInput {
  readonly hlc: string;
  readonly deviceId: string;
  readonly opVersion: number;
  readonly payload: string;
}

interface AppendBody {
  readonly ops?: unknown;
}

interface OpRow {
  readonly seq: number;
  readonly hlc: string;
  readonly device_id: string;
  readonly op_version: number;
  readonly payload: Buffer;
  readonly iv: Buffer | null;
  readonly received_at: string;
}

function isValidOpInput(value: unknown): value is OpInput {
  if (typeof value !== 'object' || value === null) return false;
  const op = value as Record<string, unknown>;
  return (
    isHlc(op.hlc) &&
    typeof op.deviceId === 'string' &&
    op.deviceId !== '' &&
    typeof op.opVersion === 'number' &&
    Number.isInteger(op.opVersion) &&
    typeof op.payload === 'string' &&
    isValidBase64(op.payload)
  );
}

/** `requireUser` is a preHandler on both routes below, so by the time a handler body runs this cannot be unset. */
function authenticatedUser(request: FastifyRequest): User {
  if (!request.user) throw new Error('requireUser preHandler did not run before this handler.');
  return request.user;
}

export function registerOpsRoutes(app: FastifyInstance, db: Database): void {
  const configuredKey = loadEncryptionKey();
  if (configuredKey) {
    app.log.info('ASTRAYA_ENCRYPTION_KEY is set: the sync relay is enabled.');
  } else {
    app.log.warn(
      'ASTRAYA_ENCRYPTION_KEY is not set: the sync relay is disabled. Local accounts and everything else on this server work as normal.',
    );
  }

  app.post<{ Body: AppendBody }>(
    '/api/ops',
    { preHandler: requireUser(db), config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      // Never a silent no-op: a disabled relay says so, rather than accepting a
      // write it would have to leave unencrypted.
      const key = configuredKey;
      if (!key) return reply.code(503).send({ error: 'Sync is not configured on this server.' });
      const user = authenticatedUser(request);

      const ops = request.body.ops;
      if (!Array.isArray(ops) || ops.length === 0) {
        return reply.code(400).send({ error: 'ops must be a non-empty array' });
      }
      if (ops.length > MAX_BATCH_SIZE) {
        return reply.code(400).send({ error: `ops batch too large (max ${MAX_BATCH_SIZE})` });
      }
      if (!ops.every(isValidOpInput)) {
        return reply.code(400).send({ error: 'Each op needs hlc, deviceId, opVersion and payload' });
      }

      // An op this far ahead of the server's own clock is never stored — the client's clock
      // was wrong when it wrote the op, and retrying will not change that op's timestamp.
      // Unlike the checks above, this is not a client bug: the rest of the batch is still
      // good, so only the skewed ops are set aside (#105, #312) rather than failing the
      // whole request — the client is expected to quarantine exactly the HLCs named in
      // `skipped` and keep pushing everything else.
      const now = Date.now();
      const skipped: string[] = [];
      const accepted = ops.filter((op) => {
        if (decodeHlc(op.hlc).millis - now > MAX_CLOCK_SKEW_MS) {
          skipped.push(op.hlc);
          return false;
        }
        return true;
      });
      if (skipped.length > 0) {
        app.log.warn(
          `Rejected ${String(skipped.length)} op(s) more than ${String(MAX_CLOCK_SKEW_MS)}ms ahead of server time.`,
        );
      }

      const { count: existingCount } = db
        .prepare('SELECT COUNT(*) AS count FROM ops WHERE user_id = ?')
        .get(user.id) as {
        count: number;
      };
      if (existingCount + accepted.length > MAX_OPS_PER_USER) {
        return reply.code(409).send({ error: `Storage quota exceeded (${String(MAX_OPS_PER_USER)} ops).` });
      }

      const insert = db.prepare(
        'INSERT INTO ops (user_id, hlc, device_id, op_version, payload, key_version, iv, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      const findExisting = db.prepare('SELECT seq FROM ops WHERE user_id = ? AND hlc = ?');
      const receivedAt = new Date(now).toISOString();

      // Transactional (#320/#337): a mid-batch throw (a bad payload slipping past
      // validation, an unexpected constraint failure) must leave no partial batch
      // committed — every op in this request is stored, or none are.
      //
      // A sequential loop, not `accepted.map(...)`: a purge marker (#308) has to take
      // effect — via `recordPurgeAndErase` — before a later op in the *same* batch for
      // the same entity is checked against the deny-list, and a plain `.map` gives no
      // place to run that side effect between iterations.
      db.exec('BEGIN');
      const seqs: number[] = [];
      try {
        for (const op of accepted) {
          const aheadByMs = decodeHlc(op.hlc).millis - now;
          if (aheadByMs > SKEW_WARN_THRESHOLD_MS) {
            app.log.warn(`Accepted op from device ${op.deviceId} with clock ${aheadByMs}ms ahead of server time.`);
          }

          const plaintext = Buffer.from(op.payload, 'base64');
          // Parsed, not decrypted — the server already holds this plaintext transiently
          // (it is about to encrypt it below), so reading `entity`/`entityId`/`field`/
          // `value` here needs no new capability, only this narrow, documented exception
          // to "the relay never interprets a payload" (see `server/ops/purge.ts`).
          const body = parseOpBody(plaintext);
          const marker = body !== undefined && isPurgeMarker(body);

          if (body !== undefined && !marker && isEntityPurged(db, user.id, body.entity, body.entityId)) {
            // A stale edit for an entity this user already purged elsewhere: refused
            // rather than stored, and reported the same way a clock-skewed op already is
            // — the client quarantines any hlc named in `skipped` and never retries it
            // (`src/sync/engine.ts`), which is exactly right here too.
            skipped.push(op.hlc);
            continue;
          }

          const { ciphertext, iv } = encryptPayload(plaintext, key);
          let seq: number;
          try {
            const result = insert.run(
              user.id,
              op.hlc,
              op.deviceId,
              op.opVersion,
              ciphertext,
              CURRENT_KEY_VERSION,
              iv,
              receivedAt,
            );
            seq = Number(result.lastInsertRowid);
          } catch {
            // ops_user_hlc is UNIQUE: this (user, hlc) pair was already stored, so a
            // retried push is a no-op — hand back the seq it already has, rather than
            // failing the whole batch over a client that retried after a dropped reply.
            const existing = findExisting.get(user.id, op.hlc) as { seq: number } | undefined;
            if (!existing) throw new Error(`Insert of hlc=${op.hlc} failed for a reason other than a duplicate.`);
            seq = existing.seq;
          }
          seqs.push(seq);

          // Erased immediately, in the same transaction, rather than after commit: an
          // earlier op in this same batch for the same entity must already be gone by
          // the time this request returns, and the deny-list check above must already
          // see this entity as purged for anything still left in the loop.
          if (marker) {
            recordPurgeAndErase(db, user.id, body.entity, body.entityId, receivedAt, op.hlc, key);
          }
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      return reply.send({ seqs, skipped });
    },
  );

  app.get<{ Querystring: { since?: string } }>(
    '/api/ops',
    { preHandler: requireUser(db), config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const key = configuredKey;
      if (!key) return reply.code(503).send({ error: 'Sync is not configured on this server.' });
      const user = authenticatedUser(request);

      // Matched against digits rather than handed straight to `Number`, which maps `''` and
      // `' '` to 0 (#336). Everywhere else that would be harmless; here 0 means "send the
      // whole log from the beginning", so a client that built a blank `?since=` by mistake
      // would silently re-download every operation it already has instead of being told.
      const raw = request.query.since ?? '0';
      if (!/^\d+$/.test(raw)) {
        return reply.code(400).send({ error: 'since must be a non-negative integer' });
      }
      const since = Number(raw);
      if (!Number.isSafeInteger(since)) {
        return reply.code(400).send({ error: 'since must be a non-negative integer' });
      }

      const rows = db
        .prepare(
          'SELECT seq, hlc, device_id, op_version, payload, iv, received_at FROM ops WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?',
        )
        .all(user.id, since, MAX_PAGE_SIZE) as unknown as OpRow[];

      const results = rows.map((row) => {
        // Every row this relay ever writes has an iv (see the insert above); a null
        // one would mean a row written some other way, which is a bug, not data.
        if (!row.iv) throw new Error(`ops row seq=${row.seq} has no iv; the relay never writes unencrypted rows.`);
        return {
          seq: row.seq,
          hlc: row.hlc,
          deviceId: row.device_id,
          opVersion: row.op_version,
          payload: decryptPayload(row.payload, row.iv, key).toString('base64'),
          receivedAt: row.received_at,
        };
      });

      return reply.send({ ops: results });
    },
  );
}
