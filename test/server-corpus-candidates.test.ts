/**
 * Bulk-candidate review queue (`server/corpus-candidates.ts` +
 * `server/corpus-candidates-routes.ts`, #370), exercised through Fastify's `app.inject()`
 * against a temp SQLite file — same shape as `test/server-corpus-overrides.test.ts`, which
 * this borrows its admin/second-user setup helpers from.
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
import { LOCALES, PERSONA_IDS, TIERS } from '../server/corpus-candidates.ts';
import { CORPUS_LOCALES, CORPUS_TIERS, PERSONA_IDS as SCHEMA_PERSONA_IDS } from '../src/interpretation/schema.ts';

const BOOTSTRAP_TOKEN = 'test-bootstrap-token';
const SESSION_COOKIE = 'astraya_session';
const ENCRYPTION_KEY = randomBytes(32).toString('base64');

interface CandidateJson {
  readonly id: string;
  readonly key: string;
  readonly locale: string;
  readonly persona?: string;
  readonly text: string;
  readonly source: string;
  readonly triageSignal?: string;
  readonly triageScore?: number;
  readonly status: string;
}
interface ListResponseJson {
  readonly candidates: readonly CandidateJson[];
}
interface DecideResponseJson {
  readonly decided: readonly string[];
  readonly missing: readonly string[];
}
interface PublicOverrideEntriesJson {
  readonly entries: readonly { readonly key: string; readonly text: string }[];
}

process.env.LOG_LEVEL = 'silent';

let dir: string;
let dbPath: string;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-corpus-candidates-test-'));
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

async function createAndLoginUser(target: FastifyInstance, username: string, password: string): Promise<string> {
  const passwordHash = await hashPassword(password);
  const raw = new DatabaseSync(dbPath);
  raw
    .prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(randomUUID(), username, passwordHash, new Date().toISOString());
  raw.close();

  const login = await target.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
  const sessionId = login.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
  if (!sessionId) throw new Error('login did not set a session cookie');
  return sessionId;
}

const GOOD_TEXT = 'A steady, deliberate approach that grows more confident with practice over time.';

function candidate(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    key: 'dignity-state:sun:ruler',
    locale: 'en',
    text: GOOD_TEXT,
    tier: 'core',
    tags: [],
    source: 'llm-fill',
    ...overrides,
  };
}

/** `server/corpus-candidates.ts` duplicates these three literal unions rather than
 * value-importing `schema.ts` — same reason `corpus-overrides.ts` does (see its own doc
 * comment). This is the test that keeps the duplicate honest. */
describe('literal-array cross-check', () => {
  it('LOCALES matches schema.ts CORPUS_LOCALES', () => {
    expect(LOCALES).toEqual(CORPUS_LOCALES);
  });

  it('TIERS matches schema.ts CORPUS_TIERS', () => {
    expect(TIERS).toEqual(CORPUS_TIERS);
  });

  it('PERSONA_IDS matches schema.ts PERSONA_IDS', () => {
    expect(PERSONA_IDS).toEqual(SCHEMA_PERSONA_IDS);
  });
});

describe('routes require admin', () => {
  it('rejects an unauthenticated import with 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/corpus-candidates/import',
      payload: { candidates: [candidate()] },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a non-admin import with 403', async () => {
    await setupAdmin(app);
    const cookie = await createAndLoginUser(app, 'bob', 'correct-horse-battery');
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/corpus-candidates/import',
      cookies: { [SESSION_COOKIE]: cookie },
      payload: { candidates: [candidate()] },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects an unauthenticated list with 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/corpus-candidates' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an unauthenticated decide with 401', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/admin/corpus-candidates',
      payload: { ids: ['x'], decision: 'accept' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/admin/corpus-candidates/import', () => {
  it('imports and lists as pending', async () => {
    const adminCookie = await setupAdmin(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/corpus-candidates/import',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: { candidates: [candidate()] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ imported: number }>().imported).toBe(1);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/corpus-candidates',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    const { candidates } = list.json<ListResponseJson>();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ key: 'dignity-state:sun:ruler', source: 'llm-fill', status: 'pending' });
  });

  it('re-importing the same (key, locale, persona, source) updates in place rather than duplicating', async () => {
    const adminCookie = await setupAdmin(app);
    await app.inject({
      method: 'POST',
      url: '/api/admin/corpus-candidates/import',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: { candidates: [candidate({ triageScore: 0.9 })] },
    });
    await app.inject({
      method: 'POST',
      url: '/api/admin/corpus-candidates/import',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: { candidates: [candidate({ text: `${GOOD_TEXT} Revised.`, triageScore: 0.4 })] },
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/corpus-candidates',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    const { candidates } = list.json<ListResponseJson>();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.text).toBe(`${GOOD_TEXT} Revised.`);
    expect(candidates[0]?.triageScore).toBe(0.4);
  });

  it('lets a classical-seed and an llm-fill candidate for the same placement coexist (#370 dedup)', async () => {
    const adminCookie = await setupAdmin(app);
    await app.inject({
      method: 'POST',
      url: '/api/admin/corpus-candidates/import',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: {
        candidates: [
          candidate({ source: 'classical-seed' }),
          candidate({ source: 'llm-fill', text: `${GOOD_TEXT} Alt.` }),
        ],
      },
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/corpus-candidates',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    const { candidates } = list.json<ListResponseJson>();
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.source).sort()).toEqual(['classical-seed', 'llm-fill']);
  });

  it('rejects an empty candidates array with 400', async () => {
    const adminCookie = await setupAdmin(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/corpus-candidates/import',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: { candidates: [] },
    });
    expect(response.statusCode).toBe(400);
  });

  it('rejects an invalid source with 400', async () => {
    const adminCookie = await setupAdmin(app);
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/corpus-candidates/import',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: { candidates: [candidate({ source: 'not-a-source' })] },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/admin/corpus-candidates', () => {
  it('defaults to status=pending and sorts worst triage score first', async () => {
    const adminCookie = await setupAdmin(app);
    await app.inject({
      method: 'POST',
      url: '/api/admin/corpus-candidates/import',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: {
        candidates: [
          candidate({ key: 'dignity-state:moon:ruler', triageSignal: 'match', triageScore: 0.9 }),
          candidate({ key: 'dignity-state:mars:ruler', triageSignal: 'mismatch', triageScore: 0.1 }),
        ],
      },
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/corpus-candidates',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    const { candidates } = list.json<ListResponseJson>();
    expect(candidates.map((c) => c.key)).toEqual(['dignity-state:mars:ruler', 'dignity-state:moon:ruler']);
  });

  it('filters by locale', async () => {
    const adminCookie = await setupAdmin(app);
    await app.inject({
      method: 'POST',
      url: '/api/admin/corpus-candidates/import',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: { candidates: [candidate({ locale: 'en' }), candidate({ locale: 'nl' })] },
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/corpus-candidates?locale=nl',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    const { candidates } = list.json<ListResponseJson>();
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.locale).toBe('nl');
  });
});

describe('PATCH /api/admin/corpus-candidates', () => {
  async function importOne(adminCookie: string, overrides: Partial<Record<string, unknown>> = {}): Promise<string> {
    const body = candidate(overrides);
    await app.inject({
      method: 'POST',
      url: '/api/admin/corpus-candidates/import',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: { candidates: [body] },
    });
    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/corpus-candidates',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    // Filtered by key, not `[0]`: earlier calls in the same test may have left other
    // still-pending candidates in the queue, and list order is by triage score, not import order.
    const match = list.json<ListResponseJson>().candidates.find((row) => row.key === body.key);
    if (match === undefined) throw new Error('test fixture bug: candidate was not imported');
    return match.id;
  }

  it('accepting turns the candidate into a live override and removes it from the queue', async () => {
    const adminCookie = await setupAdmin(app);
    const id = await importOne(adminCookie);

    const decide = await app.inject({
      method: 'PATCH',
      url: '/api/admin/corpus-candidates',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: { ids: [id], decision: 'accept' },
    });
    expect(decide.statusCode).toBe(200);
    expect(decide.json<DecideResponseJson>()).toEqual({ decided: [id], missing: [] });

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/corpus-candidates',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(list.json<ListResponseJson>().candidates).toHaveLength(0);

    const publicOverrides = await app.inject({ method: 'GET', url: '/api/corpus-overrides/en' });
    const { entries } = publicOverrides.json<PublicOverrideEntriesJson>();
    expect(entries).toEqual([expect.objectContaining({ key: 'dignity-state:sun:ruler', text: GOOD_TEXT })]);
  });

  it('rejecting removes the candidate without creating an override', async () => {
    const adminCookie = await setupAdmin(app);
    const id = await importOne(adminCookie);

    const decide = await app.inject({
      method: 'PATCH',
      url: '/api/admin/corpus-candidates',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: { ids: [id], decision: 'reject' },
    });
    expect(decide.statusCode).toBe(200);
    expect(decide.json<DecideResponseJson>()).toEqual({ decided: [id], missing: [] });

    const publicOverrides = await app.inject({ method: 'GET', url: '/api/corpus-overrides/en' });
    expect(publicOverrides.json<PublicOverrideEntriesJson>().entries).toHaveLength(0);
  });

  it('accepts a batch and reports an already-decided id as missing', async () => {
    const adminCookie = await setupAdmin(app);
    const idA = await importOne(adminCookie, { key: 'dignity-state:moon:ruler' });
    const idB = await importOne(adminCookie, { key: 'dignity-state:mars:ruler' });

    const decide = await app.inject({
      method: 'PATCH',
      url: '/api/admin/corpus-candidates',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: { ids: [idA, idB, 'no-such-id'], decision: 'accept' },
    });
    const result = decide.json<DecideResponseJson>();
    expect([...result.decided].sort()).toEqual([idA, idB].sort());
    expect(result.missing).toEqual(['no-such-id']);
  });

  it('rejects an accept batch with 400, and decides nothing, if any candidate fails the content-quality lint (#354)', async () => {
    const adminCookie = await setupAdmin(app);
    const goodId = await importOne(adminCookie, { key: 'dignity-state:moon:ruler' });
    const badId = await importOne(adminCookie, { key: 'dignity-state:mars:ruler', text: 'Too short' });

    const decide = await app.inject({
      method: 'PATCH',
      url: '/api/admin/corpus-candidates',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: { ids: [goodId, badId], decision: 'accept' },
    });
    expect(decide.statusCode).toBe(400);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/corpus-candidates',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(list.json<ListResponseJson>().candidates).toHaveLength(2);
  });

  it('rejects an invalid decision with 400', async () => {
    const adminCookie = await setupAdmin(app);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/admin/corpus-candidates',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: { ids: ['x'], decision: 'maybe' },
    });
    expect(response.statusCode).toBe(400);
  });
});
