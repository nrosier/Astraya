/**
 * Admin corpus corrections (`server/corpus-overrides.ts` +
 * `server/corpus-overrides-routes.ts`, #292), exercised through Fastify's
 * `app.inject()` against a temp SQLite file — same shape as
 * `test/server-admin.test.ts`, which this borrows its admin/second-user setup
 * helpers from.
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
import { LOCALES, TIERS, PERSONA_IDS } from '../server/corpus-overrides.ts';
import {
  CORPUS_LOCALES,
  CORPUS_TIERS,
  PERSONA_IDS as SCHEMA_PERSONA_IDS,
  validateCorpusEntries,
} from '../src/interpretation/schema.ts';

const BOOTSTRAP_TOKEN = 'test-bootstrap-token';
const SESSION_COOKIE = 'astraya_session';
const ENCRYPTION_KEY = randomBytes(32).toString('base64');

interface OverrideJson {
  readonly id: string;
  readonly text: string;
  readonly tier: string;
  readonly tags: readonly string[];
}
interface UpsertResponseJson {
  readonly override: OverrideJson;
}
interface ListResponseJson {
  readonly overrides: readonly OverrideJson[];
}
interface PublicEntriesResponseJson {
  readonly entries: readonly {
    readonly key: string;
    readonly provenance: { readonly source: string; readonly reviewedBy?: string };
  }[];
}

process.env.LOG_LEVEL = 'silent';

let dir: string;
let dbPath: string;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-corpus-overrides-test-'));
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

/**
 * `server/corpus-overrides.ts` duplicates these three literal unions rather
 * than value-importing `schema.ts` (see that file's own doc comment for why).
 * This is the test that keeps the duplicate honest.
 */
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

describe('write routes require admin', () => {
  const upsertBody = {
    key: 'dignity-state:sun:ruler',
    locale: 'en',
    text: 'Corrected text',
    tier: 'core',
    tags: ['sun'],
  };

  it('rejects an unauthenticated PUT with 401', async () => {
    const response = await app.inject({ method: 'PUT', url: '/api/admin/corpus-overrides', payload: upsertBody });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a non-admin PUT with 403', async () => {
    await setupAdmin(app);
    const cookie = await createAndLoginUser(app, 'bob', 'correct-horse-battery');
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/corpus-overrides',
      cookies: { [SESSION_COOKIE]: cookie },
      payload: upsertBody,
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects an unauthenticated DELETE with 401', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/api/admin/corpus-overrides/some-id' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an unauthenticated admin list with 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/corpus-overrides' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an unauthenticated export with 401', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/corpus-overrides/export' });
    expect(response.statusCode).toBe(401);
  });
});

describe('PUT /api/admin/corpus-overrides', () => {
  it('upserts, then updates the same (key, locale, persona) identity via ON CONFLICT', async () => {
    const adminCookie = await setupAdmin(app);

    const first = await app.inject({
      method: 'PUT',
      url: '/api/admin/corpus-overrides',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: {
        key: 'dignity-state:sun:ruler',
        locale: 'en',
        text: 'First version of the correction text, well past the forty-character minimum.',
        tier: 'core',
        tags: ['sun'],
      },
    });
    expect(first.statusCode).toBe(200);
    const firstOverride = first.json<UpsertResponseJson>().override;
    expect(firstOverride.text).toBe('First version of the correction text, well past the forty-character minimum.');

    const second = await app.inject({
      method: 'PUT',
      url: '/api/admin/corpus-overrides',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: {
        key: 'dignity-state:sun:ruler',
        locale: 'en',
        text: 'Second version of the correction text, well past the forty-character minimum.',
        tier: 'notable',
        tags: ['sun', 'fire'],
      },
    });
    expect(second.statusCode).toBe(200);
    const secondOverride = second.json<UpsertResponseJson>().override;
    expect(secondOverride.id).toBe(firstOverride.id);
    expect(secondOverride.text).toBe('Second version of the correction text, well past the forty-character minimum.');
    expect(secondOverride.tier).toBe('notable');
    expect(secondOverride.tags).toEqual(['sun', 'fire']);

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/corpus-overrides',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(list.json<ListResponseJson>().overrides).toHaveLength(1);
  });

  it('treats a persona-scoped override and a neutral override as distinct identities', async () => {
    const adminCookie = await setupAdmin(app);
    await app.inject({
      method: 'PUT',
      url: '/api/admin/corpus-overrides',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: {
        key: 'dignity-state:sun:ruler',
        locale: 'en',
        text: 'A neutral, persona-agnostic version of the correction text, past the length minimum.',
        tier: 'core',
        tags: [],
      },
    });
    await app.inject({
      method: 'PUT',
      url: '/api/admin/corpus-overrides',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: {
        key: 'dignity-state:sun:ruler',
        locale: 'en',
        persona: 'cynic',
        text: 'A cynic-persona version of the correction text, also past the length minimum.',
        tier: 'core',
        tags: [],
      },
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/corpus-overrides',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(list.json<ListResponseJson>().overrides).toHaveLength(2);
  });

  it('rejects an invalid tier with 400', async () => {
    const adminCookie = await setupAdmin(app);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/admin/corpus-overrides',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: { key: 'dignity-state:sun:ruler', locale: 'en', text: 'x', tier: 'not-a-tier', tags: [] },
    });
    expect(response.statusCode).toBe(400);
  });

  /**
   * #354 regression: an admin's hand-typed correction bypassed `lintEntry`
   * entirely, unlike a machine-generated entry from `tools/corpus-gen`, which
   * always runs through it first. Each case below is something the generator
   * pipeline would already have rejected.
   */
  describe('content-quality lint (#354)', () => {
    it('rejects text below the 40-character minimum', async () => {
      const adminCookie = await setupAdmin(app);
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/corpus-overrides',
        cookies: { [SESSION_COOKIE]: adminCookie },
        payload: { key: 'dignity-state:sun:ruler', locale: 'en', text: 'Too short', tier: 'core', tags: [] },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: string }>().error).toMatch(/40-character minimum/);
    });

    it('rejects fatalistic phrasing', async () => {
      const adminCookie = await setupAdmin(app);
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/corpus-overrides',
        cookies: { [SESSION_COOKIE]: adminCookie },
        payload: {
          key: 'dignity-state:sun:ruler',
          locale: 'en',
          text: 'With this placement, you will never succeed at anything you attempt in your career.',
          tier: 'core',
          tags: [],
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: string }>().error).toMatch(/fatalistic phrasing/);
    });

    it('rejects a gendered pronoun', async () => {
      const adminCookie = await setupAdmin(app);
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/corpus-overrides',
        cookies: { [SESSION_COOKIE]: adminCookie },
        payload: {
          key: 'dignity-state:sun:ruler',
          locale: 'en',
          text: 'This placement means he will often take the lead in group settings without hesitation.',
          tier: 'core',
          tags: [],
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: string }>().error).toMatch(/gendered pronoun/);
    });

    it('rejects a medical/legal/financial claim', async () => {
      const adminCookie = await setupAdmin(app);
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/corpus-overrides',
        cookies: { [SESSION_COOKIE]: adminCookie },
        payload: {
          key: 'dignity-state:sun:ruler',
          locale: 'en',
          text: 'This placement offers a guaranteed return on any investment you choose to make this year.',
          tier: 'core',
          tags: [],
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: string }>().error).toMatch(/medical\/legal\/financial term/);
    });

    it('accepts text that passes every lint rule', async () => {
      const adminCookie = await setupAdmin(app);
      const response = await app.inject({
        method: 'PUT',
        url: '/api/admin/corpus-overrides',
        cookies: { [SESSION_COOKIE]: adminCookie },
        payload: {
          key: 'dignity-state:sun:ruler',
          locale: 'en',
          text: 'This placement favors a steady, deliberate approach that grows more confident with practice.',
          tier: 'core',
          tags: [],
        },
      });
      expect(response.statusCode).toBe(200);
    });
  });
});

describe('GET /api/corpus-overrides/:locale (public)', () => {
  it('needs no auth and reflects the current overrides', async () => {
    const adminCookie = await setupAdmin(app);
    await app.inject({
      method: 'PUT',
      url: '/api/admin/corpus-overrides',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: {
        key: 'dignity-state:sun:ruler',
        locale: 'en',
        text: 'Corrected text, well past the forty-character minimum required by the lint check.',
        tier: 'core',
        tags: ['sun'],
      },
    });

    const anonymous = await app.inject({ method: 'GET', url: '/api/corpus-overrides/en' });
    expect(anonymous.statusCode).toBe(200);
    const { entries } = anonymous.json<PublicEntriesResponseJson>();
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry).toMatchObject({
      key: 'dignity-state:sun:ruler',
      locale: 'en',
      text: 'Corrected text, well past the forty-character minimum required by the lint check.',
      tier: 'core',
      tags: ['sun'],
    });
    // #353: the public, unauthenticated route never discloses the admin username that
    // made the correction — only the requireAdmin-gated export does.
    expect(entry?.provenance.source).toBe('hand-written');
    expect(entry?.provenance).not.toHaveProperty('reviewedBy');
  });

  it('omits reviewedBy on the public route but includes it on the admin export (#353)', async () => {
    const adminCookie = await setupAdmin(app);
    await app.inject({
      method: 'PUT',
      url: '/api/admin/corpus-overrides',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: {
        key: 'dignity-state:sun:ruler',
        locale: 'en',
        text: 'Corrected text, well past the forty-character minimum required by the lint check.',
        tier: 'core',
        tags: ['sun'],
      },
    });

    const anonymous = await app.inject({ method: 'GET', url: '/api/corpus-overrides/en' });
    const [publicEntry] = anonymous.json<PublicEntriesResponseJson>().entries;
    expect(publicEntry?.provenance).not.toHaveProperty('reviewedBy');

    const exported = await app.inject({
      method: 'GET',
      url: '/api/admin/corpus-overrides/export?locale=en',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    const [exportedEntry] = JSON.parse(exported.body) as PublicEntriesResponseJson['entries'];
    expect(exportedEntry?.provenance).toMatchObject({ reviewedBy: 'alice' });
  });

  it('reflects a delete', async () => {
    const adminCookie = await setupAdmin(app);
    const put = await app.inject({
      method: 'PUT',
      url: '/api/admin/corpus-overrides',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: {
        key: 'dignity-state:sun:ruler',
        locale: 'en',
        text: 'Corrected text, well past the forty-character minimum required by the lint check.',
        tier: 'core',
        tags: [],
      },
    });
    const { id } = put.json<UpsertResponseJson>().override;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/corpus-overrides/${id}`,
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(del.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/api/corpus-overrides/en' });
    expect(after.json<PublicEntriesResponseJson>().entries).toHaveLength(0);
  });

  it('404s deleting an override that does not exist', async () => {
    const adminCookie = await setupAdmin(app);
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/admin/corpus-overrides/no-such-id',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(response.statusCode).toBe(404);
  });

  it('rejects an unknown locale with 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/corpus-overrides/fr' });
    expect(response.statusCode).toBe(400);
  });
});

describe('GET /api/admin/corpus-overrides/export', () => {
  it('sets Content-Disposition and returns a body that validates as CorpusEntry[]', async () => {
    const adminCookie = await setupAdmin(app);
    await app.inject({
      method: 'PUT',
      url: '/api/admin/corpus-overrides',
      cookies: { [SESSION_COOKIE]: adminCookie },
      payload: {
        key: 'dignity-state:sun:ruler',
        locale: 'en',
        text: 'Corrected text, well past the forty-character minimum required by the lint check.',
        tier: 'core',
        tags: ['sun'],
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/corpus-overrides/export?locale=en',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="astraya-corpus-overrides-en-\d{4}-\d{2}-\d{2}\.json"$/,
    );

    const entries = JSON.parse(response.body) as readonly unknown[];
    const result = validateCorpusEntries(entries);
    expect(result.ok).toBe(true);
  });

  it('defaults the filename to "all" when no locale is given', async () => {
    const adminCookie = await setupAdmin(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/corpus-overrides/export',
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="astraya-corpus-overrides-all-/);
  });
});

/**
 * #352 regression: `corpus_overrides.updated_by` used to have no `ON DELETE`
 * clause, so deleting a user who had ever edited a correction threw a live
 * foreign-key-constraint error (`server/auth/admin-routes.ts`'s
 * `DELETE FROM users`) instead of taking their overrides with them, the way
 * `sessions`/`ops` already do via `ON DELETE CASCADE`.
 */
describe('deleting a user who authored an override (#352)', () => {
  it('cascades away the override instead of throwing a foreign-key error', async () => {
    const adminCookie = await setupAdmin(app, 'alice', 'correct-horse-battery');

    const bobPasswordHash = await hashPassword('correct-horse-battery');
    const bobId = randomUUID();
    const raw = new DatabaseSync(dbPath);
    raw
      .prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, 1, ?)')
      .run(bobId, 'bob', bobPasswordHash, new Date().toISOString());
    raw.close();
    const bobLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'bob', password: 'correct-horse-battery' },
    });
    const bobCookie = bobLogin.cookies.find((c) => c.name === SESSION_COOKIE)?.value;
    if (!bobCookie) throw new Error('bob login did not set a session cookie');

    const upsert = await app.inject({
      method: 'PUT',
      url: '/api/admin/corpus-overrides',
      cookies: { [SESSION_COOKIE]: bobCookie },
      payload: {
        key: 'dignity-state:sun:ruler',
        locale: 'en',
        text: 'Bob wrote this correction, and it is well past the forty-character minimum length.',
        tier: 'core',
        tags: [],
      },
    });
    expect(upsert.statusCode).toBe(200);
    const overrideId = upsert.json<UpsertResponseJson>().override.id;

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/admin/users/${bobId}`,
      cookies: { [SESSION_COOKIE]: adminCookie },
    });
    expect(deleteResponse.statusCode).toBe(200);

    const rawAfter = new DatabaseSync(dbPath);
    const remaining = rawAfter
      .prepare('SELECT COUNT(*) AS count FROM corpus_overrides WHERE id = ?')
      .get(overrideId) as {
      count: number;
    };
    rawAfter.close();
    expect(remaining.count).toBe(0);
  });
});
