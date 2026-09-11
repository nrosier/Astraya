/**
 * The operation-relay endpoints (`server/ops/routes.ts`), exercised through
 * Fastify's `app.inject()` against a temp SQLite file — same shape as
 * `test/server-auth.test.ts`. A couple of tests open a second, independent
 * connection to the same file to simulate a row written or corrupted
 * out-of-band (a duplicate retry race, a tampered payload).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { build } from '../server/index.ts';
import { hashPassword } from '../server/auth/passwords.ts';
import { createClock, encodeHlc, randomNodeId, tick } from '../src/store/hlc.ts';

const BOOTSTRAP_TOKEN = 'test-bootstrap-token';
const SESSION_COOKIE = 'astraya_session';
const ENCRYPTION_KEY = randomBytes(32).toString('base64');

process.env.LOG_LEVEL = 'silent';

let dir: string;
let dbPath: string;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-ops-test-'));
  dbPath = join(dir, 'astraya.db');
  process.env.ASTRAYA_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
  process.env.ASTRAYA_ENCRYPTION_KEY = ENCRYPTION_KEY;
  app = await build({ dbPath });
});

afterEach(async () => {
  await app.close();
  delete process.env.ASTRAYA_BOOTSTRAP_TOKEN;
  delete process.env.ASTRAYA_ENCRYPTION_KEY;
  rmSync(dir, { recursive: true, force: true });
});

/** Creates the first admin (via bootstrap) and returns its session cookie value. */
async function setupAdmin(target: FastifyInstance, username = 'alice', password = 'correct-horse-battery') {
  const response = await target.inject({
    method: 'POST',
    url: '/api/setup',
    payload: { token: BOOTSTRAP_TOKEN, username, password },
  });
  const sessionId = response.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
  if (!sessionId) throw new Error('setup did not set a session cookie');
  return sessionId;
}

/** Inserts a second, non-admin user directly (only the first admin can go through /api/setup) and logs in. */
async function createAndLoginUser(target: FastifyInstance, username: string, password: string): Promise<string> {
  const passwordHash = await hashPassword(password);
  const raw = new DatabaseSync(dbPath);
  raw
    .prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(randomUUID(), username, passwordHash, new Date().toISOString());
  raw.close();

  const login = await target.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });
  const sessionId = login.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
  if (!sessionId) throw new Error('login did not set a session cookie');
  return sessionId;
}

/** A fresh, validly-shaped op, ahead of "now" by `aheadByMs` (default: not ahead at all). */
function makeOp(aheadByMs = 0, overrides: Partial<{ deviceId: string; opVersion: number; payload: string }> = {}) {
  const clock = createClock(randomNodeId());
  const hlc = encodeHlc(tick(clock, Date.now() + aheadByMs).clock);
  return {
    hlc,
    deviceId: overrides.deviceId ?? 'device-1',
    opVersion: overrides.opVersion ?? 1,
    payload: overrides.payload ?? Buffer.from(JSON.stringify({ hello: 'world' })).toString('base64'),
  };
}

function appendOps(target: FastifyInstance, sessionId: string, ops: unknown) {
  return target.inject({
    method: 'POST',
    url: '/api/ops',
    cookies: { [SESSION_COOKIE]: sessionId },
    payload: { ops },
  });
}

function pullOps(target: FastifyInstance, sessionId: string, since?: number) {
  return target.inject({
    method: 'GET',
    url: since === undefined ? '/api/ops' : `/api/ops?since=${since}`,
    cookies: { [SESSION_COOKIE]: sessionId },
  });
}

describe('POST /api/ops and GET /api/ops', () => {
  it('round-trips an op: append assigns a seq, pull decrypts it back unchanged', async () => {
    const sessionId = await setupAdmin(app);
    const op = makeOp();

    const append = await appendOps(app, sessionId, [op]);
    expect(append.statusCode).toBe(200);
    const { seqs } = append.json<{ seqs: number[] }>();
    expect(seqs).toHaveLength(1);
    expect(seqs[0]).toBeGreaterThan(0);

    const pull = await pullOps(app, sessionId);
    expect(pull.statusCode).toBe(200);
    const { ops } = pull.json<{
      ops: { seq: number; hlc: string; deviceId: string; opVersion: number; payload: string }[];
    }>();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ seq: seqs[0], hlc: op.hlc, deviceId: op.deviceId, opVersion: op.opVersion });
    expect(ops[0]?.payload).toBe(op.payload);
  });

  it("scopes ops to the authenticated user: one user cannot see or affect another user's ops (#80)", async () => {
    const aliceSession = await setupAdmin(app, 'alice', 'correct-horse-battery');
    const bobSession = await createAndLoginUser(app, 'bob', 'another-horse-battery');

    const aliceAppend = await appendOps(app, aliceSession, [makeOp()]);
    const aliceSeq = aliceAppend.json<{ seqs: number[] }>().seqs[0];

    const bobPull = await pullOps(app, bobSession);
    expect(bobPull.json<{ ops: unknown[] }>().ops).toHaveLength(0);

    // Bob pulling "since" a seq lower than Alice's still sees nothing of hers.
    const bobPullSince = await pullOps(app, bobSession, (aliceSeq ?? 1) - 1);
    expect(bobPullSince.json<{ ops: unknown[] }>().ops).toHaveLength(0);

    const bobAppend = await appendOps(app, bobSession, [makeOp()]);
    const bobSeq = bobAppend.json<{ seqs: number[] }>().seqs[0];
    expect(bobSeq).not.toBe(aliceSeq);

    const alicePull = await pullOps(app, aliceSession);
    expect(alicePull.json<{ ops: unknown[] }>().ops).toHaveLength(1);
  });

  it('is idempotent on a retried (user, hlc) pair: same seq, no duplicate row', async () => {
    const sessionId = await setupAdmin(app);
    const op = makeOp();

    const first = await appendOps(app, sessionId, [op]);
    const second = await appendOps(app, sessionId, [op]);
    expect(first.json<{ seqs: number[] }>().seqs).toEqual(second.json<{ seqs: number[] }>().seqs);

    const pull = await pullOps(app, sessionId);
    expect(pull.json<{ ops: unknown[] }>().ops).toHaveLength(1);
  });

  it('accepts an op whose clock is ahead but within the skew-tolerance band', async () => {
    const sessionId = await setupAdmin(app);
    const op = makeOp(2 * 60 * 60 * 1000); // 2h ahead: over the 5-minute warn line, under the 24h reject line.
    const response = await appendOps(app, sessionId, [op]);
    expect(response.statusCode).toBe(200);
  });

  it('rejects an op more than 24h ahead of server time with a distinct clock-skew error (#105)', async () => {
    const sessionId = await setupAdmin(app);
    const op = makeOp(25 * 60 * 60 * 1000);
    const response = await appendOps(app, sessionId, [op]);
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: string }>().error).toBe('clock-skew');

    const pull = await pullOps(app, sessionId);
    expect(pull.json<{ ops: unknown[] }>().ops).toHaveLength(0);
  });

  it('rejects a malformed op with 400', async () => {
    const sessionId = await setupAdmin(app);
    const response = await appendOps(app, sessionId, [
      { hlc: 'not-a-real-hlc', deviceId: 'd1', opVersion: 1, payload: 'x' },
    ]);
    expect(response.statusCode).toBe(400);
  });

  it('a tampered stored payload fails decryption loudly rather than returning wrong or empty data', async () => {
    const sessionId = await setupAdmin(app);
    const append = await appendOps(app, sessionId, [makeOp()]);
    const seq = append.json<{ seqs: number[] }>().seqs[0];
    if (seq === undefined) throw new Error('append did not return a seq');

    const raw = new DatabaseSync(dbPath);
    raw.prepare('UPDATE ops SET payload = ? WHERE seq = ?').run(Buffer.from('this is not a valid gcm ciphertext'), seq);
    raw.close();

    const pull = await pullOps(app, sessionId);
    expect(pull.statusCode).toBe(500);
  });

  it('returns 401 for both routes with no session cookie', async () => {
    const append = await app.inject({ method: 'POST', url: '/api/ops', payload: { ops: [makeOp()] } });
    const pull = await app.inject({ method: 'GET', url: '/api/ops' });
    expect(append.statusCode).toBe(401);
    expect(pull.statusCode).toBe(401);
  });

  it('returns 503 for both routes when no encryption key is configured', async () => {
    delete process.env.ASTRAYA_ENCRYPTION_KEY;
    const disabledDir = mkdtempSync(join(tmpdir(), 'astraya-ops-disabled-test-'));
    const disabledApp = await build({ dbPath: join(disabledDir, 'astraya.db') });
    try {
      const sessionId = await setupAdmin(disabledApp);
      const append = await appendOps(disabledApp, sessionId, [makeOp()]);
      const pull = await pullOps(disabledApp, sessionId);
      expect(append.statusCode).toBe(503);
      expect(pull.statusCode).toBe(503);
    } finally {
      await disabledApp.close();
      rmSync(disabledDir, { recursive: true, force: true });
    }
  });

  it('throws at startup on a malformed encryption key instead of silently disabling the relay', async () => {
    process.env.ASTRAYA_ENCRYPTION_KEY = 'not-the-right-length';
    const badKeyDir = mkdtempSync(join(tmpdir(), 'astraya-ops-badkey-test-'));
    try {
      await expect(build({ dbPath: join(badKeyDir, 'astraya.db') })).rejects.toThrow();
    } finally {
      rmSync(badKeyDir, { recursive: true, force: true });
    }
  });
});
