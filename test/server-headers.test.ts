/**
 * The response headers and the origin check every route gets from `server/index.ts`'s own
 * hooks (#329, #339) — as opposed to the policy *contents*, which `test/csp.test.ts` owns.
 *
 * Both of these are the kind of defence that is easy to add and easier to lose: they live in
 * a global hook nobody reads while adding a route, so nothing but a test notices when one
 * stops being sent.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { build } from '../server/index.ts';
import { isCrossOriginWrite } from '../server/csrf.ts';

process.env.LOG_LEVEL = 'silent';

let dir: string;
let app: FastifyInstance | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-headers-test-'));
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  delete process.env.ASTRAYA_PUBLIC_URL;
  rmSync(dir, { recursive: true, force: true });
});

function boot(): Promise<FastifyInstance> {
  return build({ dbPath: join(dir, 'astraya.db') }).then((built) => {
    app = built;
    return built;
  });
}

describe('Strict-Transport-Security', () => {
  it('is sent when ASTRAYA_PUBLIC_URL says the deployment is served over https', async () => {
    process.env.ASTRAYA_PUBLIC_URL = 'https://astraya.example.com';
    const response = await (await boot()).inject({ method: 'GET', url: '/healthz' });
    expect(response.headers['strict-transport-security']).toBe('max-age=15552000; includeSubDomains');
  });

  it('is not sent for a plain-http deployment, which HSTS would make unreachable', async () => {
    // The local-network case this app is built for. A browser that had once seen the
    // header would refuse the http origin for the whole max-age, with no way back.
    process.env.ASTRAYA_PUBLIC_URL = 'http://192.168.1.10:8080';
    const response = await (await boot()).inject({ method: 'GET', url: '/healthz' });
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('is not sent when no public URL is configured at all', async () => {
    const response = await (await boot()).inject({ method: 'GET', url: '/healthz' });
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('does not fail the boot over a malformed public URL', async () => {
    // `ASTRAYA_PUBLIC_URL` is only *required* with OIDC configured, so a garbled value on
    // a server that has no other use for it must not be the thing that stops it starting.
    process.env.ASTRAYA_PUBLIC_URL = 'astraya.example.com';
    const response = await (await boot()).inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['strict-transport-security']).toBeUndefined();
  });

  it('accompanies the headers that were already there', async () => {
    const response = await (await boot()).inject({ method: 'GET', url: '/healthz' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
  });
});

describe('the origin check (#329)', () => {
  it('refuses a write carrying a foreign Origin', async () => {
    const response = await (
      await boot()
    ).inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { username: 'alice', password: 'correct-horse-battery' },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: string }>().error).toMatch(/cross-origin/i);
  });

  it('allows a write from the origin the request was addressed to', async () => {
    const built = await boot();
    const response = await built.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { host: 'astraya.example.com', origin: 'https://astraya.example.com' },
      payload: { username: 'alice', password: 'correct-horse-battery' },
    });
    // 401, not 403: the request got as far as the credentials, which is the point.
    expect(response.statusCode).toBe(401);
  });

  it('allows a write with no Origin at all, which is every non-browser client', async () => {
    const response = await (
      await boot()
    ).inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'alice', password: 'correct-horse-battery' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('does not block a cross-origin read, which has nothing to forge', async () => {
    const response = await (
      await boot()
    ).inject({
      method: 'GET',
      url: '/healthz',
      headers: { origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('isCrossOriginWrite', () => {
  const allowedHosts = ['astraya.example.com', 'astraya.internal:8080'];

  it('ignores the safe methods', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(isCrossOriginWrite({ method, origin: 'https://evil.example', allowedHosts })).toBe(false);
    }
  });

  it('refuses every state-changing method from a foreign origin', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'delete']) {
      expect(isCrossOriginWrite({ method, origin: 'https://evil.example', allowedHosts })).toBe(true);
    }
  });

  it('compares hosts, not schemes, so a proxy that drops X-Forwarded-Proto still works', () => {
    // The one deliberate deviation from the textbook check: a TLS-terminating proxy that
    // forwards without `X-Forwarded-Proto` makes the server see `http` for a page the
    // browser loaded over `https`. A scheme-sensitive comparison would 403 every write in
    // that entirely ordinary setup.
    expect(isCrossOriginWrite({ method: 'POST', origin: 'https://astraya.example.com', allowedHosts })).toBe(false);
    expect(isCrossOriginWrite({ method: 'POST', origin: 'http://astraya.example.com', allowedHosts })).toBe(false);
  });

  it('treats the port as part of the host', () => {
    expect(isCrossOriginWrite({ method: 'POST', origin: 'http://astraya.internal:8080', allowedHosts })).toBe(false);
    expect(isCrossOriginWrite({ method: 'POST', origin: 'http://astraya.internal:9999', allowedHosts })).toBe(true);
  });

  it('refuses an opaque or unreadable Origin', () => {
    // A sandboxed iframe and a `file://` page both send the literal string `null`. No
    // legitimate client of this server does.
    for (const origin of ['null', '', 'not a url', 'https://']) {
      expect(isCrossOriginWrite({ method: 'POST', origin, allowedHosts })).toBe(true);
    }
  });

  it('allows an absent Origin, because browsers always send one on a write', () => {
    expect(isCrossOriginWrite({ method: 'POST', origin: undefined, allowedHosts })).toBe(false);
  });
});
