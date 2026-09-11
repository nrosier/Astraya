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

/** An HLC this far ahead of the server's own clock is rejected outright (#105). */
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
/** Within the reject bound but still this far ahead: accepted, but logged, so a persistent offender is diagnosable. */
const SKEW_WARN_THRESHOLD_MS = 5 * 60 * 1000;

/** Bounds on a single request, so one client can't hand the server an unbounded array or an unbounded result set. */
const MAX_BATCH_SIZE = 500;
const MAX_PAGE_SIZE = 500;

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
    typeof op.payload === 'string'
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

  app.post<{ Body: AppendBody }>('/api/ops', { preHandler: requireUser(db) }, async (request, reply) => {
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

    const now = Date.now();
    for (const op of ops) {
      if (decodeHlc(op.hlc).millis - now > MAX_CLOCK_SKEW_MS) {
        return reply.code(400).send({ error: 'clock-skew', message: "This device's clock looks wrong." });
      }
    }

    const insert = db.prepare(
      'INSERT INTO ops (user_id, hlc, device_id, op_version, payload, key_version, iv, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const findExisting = db.prepare('SELECT seq FROM ops WHERE user_id = ? AND hlc = ?');
    const receivedAt = new Date(now).toISOString();

    const seqs = ops.map((op) => {
      const aheadByMs = decodeHlc(op.hlc).millis - now;
      if (aheadByMs > SKEW_WARN_THRESHOLD_MS) {
        app.log.warn(`Accepted op from device ${op.deviceId} with clock ${aheadByMs}ms ahead of server time.`);
      }
      const { ciphertext, iv } = encryptPayload(Buffer.from(op.payload, 'base64'), key);
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
        return Number(result.lastInsertRowid);
      } catch {
        // ops_user_hlc is UNIQUE: this (user, hlc) pair was already stored, so a
        // retried push is a no-op — hand back the seq it already has, rather than
        // failing the whole batch over a client that retried after a dropped reply.
        const existing = findExisting.get(user.id, op.hlc) as { seq: number } | undefined;
        if (!existing) throw new Error(`Insert of hlc=${op.hlc} failed for a reason other than a duplicate.`);
        return existing.seq;
      }
    });

    return reply.send({ seqs });
  });

  app.get<{ Querystring: { since?: string } }>('/api/ops', { preHandler: requireUser(db) }, async (request, reply) => {
    const key = configuredKey;
    if (!key) return reply.code(503).send({ error: 'Sync is not configured on this server.' });
    const user = authenticatedUser(request);

    const since = Number(request.query.since ?? '0');
    if (!Number.isInteger(since) || since < 0) {
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
  });
}
