/**
 * `src/interpretation/tier2-client.ts` against a real `build()` app listening
 * on an ephemeral port — same reasoning as `test/sync-auth-client.test.ts`:
 * this module makes a real `fetch()` call, so that seam is what's worth
 * exercising, not `app.inject()`. The outbound Gemini call the server itself
 * would make (`server/interpretation/llm-client.ts`) is stubbed by URL —
 * distinct from the relative-path calls this client makes to its own
 * server — so this test never reaches a real third-party endpoint.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { build } from '../server/index.ts';
import { generateTier2Interpretation, Tier2Error } from '../src/interpretation/tier2-client.ts';

const BOOTSTRAP_TOKEN = 'test-bootstrap-token';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

process.env.LOG_LEVEL = 'silent';

let dir: string;
let app: FastifyInstance;
let baseUrl: string;
let requestBodies: unknown[];
const realFetch = globalThis.fetch;

function geminiOk(sectionBody: string): Response {
  const text = JSON.stringify({ sections: [{ heading: 'Overview', body: sectionBody }] });
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
    }),
    { status: 200 },
  );
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-tier2-client-test-'));
  process.env.ASTRAYA_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
  process.env.ASTRAYA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.ASTRAYA_INTERPRETATION_API_KEY = 'test-gemini-key';
  app = await build({ dbPath: join(dir, 'astraya.db') });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind to a port');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;

  requestBodies = [];
  let cookie: string | undefined;
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.startsWith(GEMINI_BASE_URL)) return geminiOk('A restyled interpretation.');
    if (typeof init?.body === 'string') requestBodies.push(JSON.parse(init.body));
    const target = new URL(url, baseUrl);
    const headers = new Headers(init?.headers);
    if (cookie !== undefined) headers.set('cookie', cookie);
    const response = await realFetch(target, { ...init, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie !== null) cookie = setCookie.split(';')[0];
    return response;
  };
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await app.close();
  delete process.env.ASTRAYA_BOOTSTRAP_TOKEN;
  delete process.env.ASTRAYA_ENCRYPTION_KEY;
  delete process.env.ASTRAYA_INTERPRETATION_API_KEY;
  rmSync(dir, { recursive: true, force: true });
});

/** Goes through the wrapped `fetch` above (not `realFetch`) so the session cookie it sets is captured. */
async function setupAdmin(username = 'alice', password = 'correct-horse-battery'): Promise<void> {
  const response = await fetch('/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: BOOTSTRAP_TOKEN, username, password }),
  });
  if (!response.ok) throw new Error(`setup failed with status ${String(response.status)}`);
}

describe('generateTier2Interpretation', () => {
  it('resolves with the generated sections on a successful response', async () => {
    await setupAdmin();
    const sections = await generateTier2Interpretation(['dignity-state:sun:ruler'], 'warm and encouraging', 'en');
    expect(sections).toEqual([{ heading: 'Overview', body: 'A restyled interpretation.' }]);
  });

  it('sends placementKeys, customPrompt, and locale as the request body', async () => {
    await setupAdmin();
    await generateTier2Interpretation(['dignity-state:sun:ruler', 'planet-in-sign:moon:3'], 'blunt and direct', 'nl');

    const sent = requestBodies.at(-1);
    expect(sent).toEqual({
      placementKeys: ['dignity-state:sun:ruler', 'planet-in-sign:moon:3'],
      customPrompt: 'blunt and direct',
      locale: 'nl',
    });
  });

  it('throws a Tier2Error carrying the server’s own message and status on a non-2xx response', async () => {
    await setupAdmin();
    await expect(generateTier2Interpretation([], 'warm and encouraging', 'en')).rejects.toMatchObject({
      name: 'Tier2Error',
      status: 400,
      message: 'placementKeys must be a non-empty array',
    });
  });

  it('throws a Tier2Error with status 401 when signed out', async () => {
    await expect(
      generateTier2Interpretation(['dignity-state:sun:ruler'], 'warm and encouraging', 'en'),
    ).rejects.toMatchObject({ name: 'Tier2Error', status: 401 });
  });

  it('falls back to a generic message when the error response body is not JSON', async () => {
    globalThis.fetch = () => Promise.resolve(new Response('not json', { status: 500 }));
    await expect(generateTier2Interpretation(['dignity-state:sun:ruler'], 'x', 'en')).rejects.toMatchObject({
      name: 'Tier2Error',
      status: 500,
      message: 'Request failed with status 500',
    });
  });

  it('is a plain Error subclass carrying the HTTP status', () => {
    const error = new Tier2Error('nope', 503);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(503);
    expect(error.message).toBe('nope');
  });
});
