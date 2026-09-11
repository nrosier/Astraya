/**
 * OIDC opt-in (#75, #76, #77, #136), exercised against a fake Authentik: a real,
 * second Fastify instance serving discovery/token/JWKS/end_session, driven by
 * real HTTP the same way `test/sync-engine.test.ts` drives a real server rather
 * than mocking the network. The app under test is exercised via `app.inject()`
 * (no socket needed for *inbound* requests to it) — only the fake IdP needs a
 * real listening port, since `server/auth/oidc.ts` makes real outbound `fetch()`
 * calls to it.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type FastifyInstance } from 'fastify';
import { generateKeyPair } from 'jose';
import { build } from '../server/index.ts';
import { startFakeAuthentik, type FakeAuthentik } from './fake-authentik.ts';

process.env.LOG_LEVEL = 'silent';

const BOOTSTRAP_TOKEN = 'test-bootstrap-token';
const SESSION_COOKIE = 'astraya_session';
const CLIENT_ID = 'astraya-test-client';

let dir: string;
let dbPath: string;
let app: FastifyInstance;
let fakeAuthentik: FakeAuthentik;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-oidc-test-'));
  dbPath = join(dir, 'astraya.db');
  fakeAuthentik = await startFakeAuthentik(CLIENT_ID);
  process.env.ASTRAYA_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
  process.env.ASTRAYA_OIDC_ISSUER = fakeAuthentik.baseUrl;
  process.env.ASTRAYA_OIDC_CLIENT_ID = CLIENT_ID;
  process.env.ASTRAYA_PUBLIC_URL = 'http://localhost:8080';
  app = await build({ dbPath });
});

afterEach(async () => {
  await app.close();
  await fakeAuthentik.close();
  delete process.env.ASTRAYA_BOOTSTRAP_TOKEN;
  delete process.env.ASTRAYA_OIDC_ISSUER;
  delete process.env.ASTRAYA_OIDC_CLIENT_ID;
  delete process.env.ASTRAYA_PUBLIC_URL;
  rmSync(dir, { recursive: true, force: true });
});

function callback(body: { code?: string; codeVerifier?: string; nonce?: string }) {
  return app.inject({ method: 'POST', url: '/api/auth/oidc/callback', payload: body });
}

describe('GET /api/auth/oidc/config', () => {
  it('reports enabled with the issuer, client id, and resolved authorization endpoint when configured', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/oidc/config' });
    expect(response.json()).toEqual({
      enabled: true,
      issuer: fakeAuthentik.baseUrl,
      clientId: CLIENT_ID,
      authorizationEndpoint: `${fakeAuthentik.baseUrl}/authorize`,
    });
  });

  it('reports disabled when the issuer is unreachable, rather than exposing a broken sign-in button', async () => {
    process.env.ASTRAYA_OIDC_ISSUER = 'http://localhost:1'; // nothing listens here
    const dir2 = mkdtempSync(join(tmpdir(), 'astraya-oidc-test-'));
    const unreachable = await build({ dbPath: join(dir2, 'astraya.db') });
    try {
      const response = await unreachable.inject({ method: 'GET', url: '/api/auth/oidc/config' });
      expect(response.json()).toEqual({ enabled: false });
    } finally {
      await unreachable.close();
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  it('reports disabled when no issuer is configured', async () => {
    delete process.env.ASTRAYA_OIDC_ISSUER;
    const dir2 = mkdtempSync(join(tmpdir(), 'astraya-oidc-test-'));
    const unconfigured = await build({ dbPath: join(dir2, 'astraya.db') });
    try {
      const response = await unconfigured.inject({ method: 'GET', url: '/api/auth/oidc/config' });
      expect(response.json()).toEqual({ enabled: false });
    } finally {
      await unconfigured.close();
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

describe('POST /api/auth/oidc/callback', () => {
  it('signs in a new identity, JIT-provisioning a user on first sign-in', async () => {
    const idToken = await fakeAuthentik.mintIdToken({
      sub: 'authentik-subject-1',
      nonce: 'nonce-1',
      preferred_username: 'alice',
    });
    fakeAuthentik.registerCode('code-1', { idToken });

    const response = await callback({ code: 'code-1', codeVerifier: 'verifier-1', nonce: 'nonce-1' });
    expect(response.statusCode).toBe(200);
    const { user } = response.json<{ user: { username: string; isAdmin: boolean } }>();
    expect(user.username).toBe('alice');
    expect(user.isAdmin).toBe(false); // OIDC never auto-admins.

    const cookie = response.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(cookie).toBeDefined();

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: String(cookie?.value) },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json<{ user: { username: string } }>().user.username).toBe('alice');
  });

  it('signs back in to the same user on a second sign-in with the same identity', async () => {
    const first = await fakeAuthentik.mintIdToken({
      sub: 'authentik-subject-2',
      nonce: 'n1',
      preferred_username: 'bob',
    });
    fakeAuthentik.registerCode('code-a', { idToken: first });
    const firstResponse = await callback({ code: 'code-a', codeVerifier: 'v', nonce: 'n1' });
    const firstUser = firstResponse.json<{ user: { id: string } }>().user;

    const second = await fakeAuthentik.mintIdToken({
      sub: 'authentik-subject-2',
      nonce: 'n2',
      preferred_username: 'bob',
    });
    fakeAuthentik.registerCode('code-b', { idToken: second });
    const secondResponse = await callback({ code: 'code-b', codeVerifier: 'v', nonce: 'n2' });
    const secondUser = secondResponse.json<{ user: { id: string } }>().user;

    expect(secondUser.id).toBe(firstUser.id);
  });

  it('rejects a nonce that does not match what the client sent', async () => {
    const idToken = await fakeAuthentik.mintIdToken({ sub: 'authentik-subject-3', nonce: 'expected-nonce' });
    fakeAuthentik.registerCode('code-nonce', { idToken });

    const response = await callback({ code: 'code-nonce', codeVerifier: 'v', nonce: 'wrong-nonce' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an expired or unrecognized authorization code', async () => {
    const response = await callback({ code: 'never-registered', codeVerifier: 'v', nonce: 'n' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an ID token signed by a key not published in the JWKS', async () => {
    const { privateKey: wrongKey } = await generateKeyPair('RS256');
    const idToken = await fakeAuthentik.mintIdToken({ sub: 'authentik-subject-4', nonce: 'n' }, wrongKey);
    fakeAuthentik.registerCode('code-badkey', { idToken });

    const response = await callback({ code: 'code-badkey', codeVerifier: 'v', nonce: 'n' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an ID token with the wrong issuer', async () => {
    const idToken = await fakeAuthentik.mintIdToken({
      sub: 'authentik-subject-5',
      nonce: 'n',
      iss: 'https://not-the-configured-issuer.example',
    });
    fakeAuthentik.registerCode('code-badiss', { idToken });

    const response = await callback({ code: 'code-badiss', codeVerifier: 'v', nonce: 'n' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an ID token with the wrong audience', async () => {
    const idToken = await fakeAuthentik.mintIdToken({
      sub: 'authentik-subject-6',
      nonce: 'n',
      aud: 'some-other-client',
    });
    fakeAuthentik.registerCode('code-badaud', { idToken });

    const response = await callback({ code: 'code-badaud', codeVerifier: 'v', nonce: 'n' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a username collision against a different, existing local identity', async () => {
    const raw = new DatabaseSync(dbPath);
    raw
      .prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run('local-carol', 'carol', 'irrelevant-hash', new Date().toISOString());
    raw.close();

    const idToken = await fakeAuthentik.mintIdToken({
      sub: 'authentik-subject-7',
      nonce: 'n',
      preferred_username: 'carol',
    });
    fakeAuthentik.registerCode('code-collide', { idToken });

    const response = await callback({ code: 'code-collide', codeVerifier: 'v', nonce: 'n' });
    expect(response.statusCode).toBe(409);
  });

  it('rejects a disabled OIDC-provisioned user exactly like a disabled local user', async () => {
    const idToken = await fakeAuthentik.mintIdToken({
      sub: 'authentik-subject-8',
      nonce: 'n',
      preferred_username: 'dave',
    });
    fakeAuthentik.registerCode('code-dave', { idToken });
    const signInResponse = await callback({ code: 'code-dave', codeVerifier: 'v', nonce: 'n' });
    const cookie = signInResponse.cookies.find((c) => c.name === SESSION_COOKIE);

    const raw = new DatabaseSync(dbPath);
    raw.prepare('UPDATE users SET disabled_at = ? WHERE username = ?').run(new Date().toISOString(), 'dave');
    raw.close();

    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: String(cookie?.value) },
    });
    expect(me.statusCode).toBe(401);
  });

  it('returns 404 when OIDC is not configured', async () => {
    delete process.env.ASTRAYA_OIDC_ISSUER;
    const dir2 = mkdtempSync(join(tmpdir(), 'astraya-oidc-test-'));
    const unconfigured = await build({ dbPath: join(dir2, 'astraya.db') });
    try {
      const response = await unconfigured.inject({
        method: 'POST',
        url: '/api/auth/oidc/callback',
        payload: { code: 'x', codeVerifier: 'v', nonce: 'n' },
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await unconfigured.close();
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});

describe('POST /api/auth/logout with an OIDC-derived session', () => {
  it('returns an endSessionUrl built from the discovery document and the session’s id token', async () => {
    const idToken = await fakeAuthentik.mintIdToken({
      sub: 'authentik-subject-9',
      nonce: 'n',
      preferred_username: 'erin',
    });
    fakeAuthentik.registerCode('code-erin', { idToken });
    const signInResponse = await callback({ code: 'code-erin', codeVerifier: 'v', nonce: 'n' });
    const cookie = signInResponse.cookies.find((c) => c.name === SESSION_COOKIE);

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: String(cookie?.value) },
    });
    const body = logoutResponse.json<{ ok: boolean; endSessionUrl?: string }>();
    expect(body.ok).toBe(true);
    expect(body.endSessionUrl).toBeDefined();
    const endSessionUrl = new URL(String(body.endSessionUrl));
    expect(endSessionUrl.origin).toBe(fakeAuthentik.baseUrl);
    expect(endSessionUrl.searchParams.get('id_token_hint')).toBe(idToken);
    expect(endSessionUrl.searchParams.get('post_logout_redirect_uri')).toBe(process.env.ASTRAYA_PUBLIC_URL);
  });

  it('local-account logout still returns no endSessionUrl even while OIDC is configured', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { token: BOOTSTRAP_TOKEN, username: 'admin', password: 'correct-horse-battery' },
    });
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'admin', password: 'correct-horse-battery' },
    });
    const cookie = loginResponse.cookies.find((c) => c.name === SESSION_COOKIE);

    const logoutResponse = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: String(cookie?.value) },
    });
    expect(logoutResponse.json()).toEqual({ ok: true });
  });
});
