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
import { generateTier2Interpretation, Tier2Error, toTier2ChartPayload } from '../src/interpretation/tier2-client.ts';
import { bodyByKey } from '../src/astrology/bodies.ts';
import type { ChartData } from '../src/domain/chart-compute.ts';
import type { BodyId, HousePositions } from '../src/ephemeris/types.ts';

function idOf(key: string): BodyId {
  const body = bodyByKey(key);
  if (body === undefined) throw new Error(`test fixture bug: no body keyed "${key}"`);
  return body.id;
}

const SUN = idOf('sun');
const MOON = idOf('moon');

const HOUSES: HousePositions = {
  cusps: [0, 10, 40, 70, 100, 130, 160, 190, 220, 250, 280, 310, 340],
  ascendant: 10,
  midheaven: 280,
  armc: 278,
  vertex: 200,
  equatorialAscendant: 12,
  coAscendantKoch: 14,
  coAscendantMunkasey: 16,
  polarAscendant: 18,
  system: 'P',
};

const FIXTURE_CHART: ChartData = {
  positions: [
    {
      body: SUN,
      longitude: 14,
      latitude: 0,
      distance: 1,
      longitudeSpeed: 1,
      latitudeSpeed: 0,
      distanceSpeed: 0,
      retrograde: false,
    },
    {
      body: MOON,
      longitude: 100,
      latitude: 0,
      distance: 1,
      longitudeSpeed: -0.5,
      latitudeSpeed: 0,
      distanceSpeed: 0,
      retrograde: true,
    },
  ],
  houses: HOUSES,
  aspects: [
    {
      bodyA: SUN,
      bodyB: MOON,
      aspect: { key: 'trine', name: 'Trine', angle: 120, family: 'major' },
      separation: 119,
      orb: 1,
      applying: false,
    },
  ],
  dignities: new Map(),
  sect: 'day',
  partOfFortune: 0,
  partOfSpirit: 0,
};

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
    if (url.startsWith(GEMINI_BASE_URL)) {
      // The custom-prompt verification call (#411) asks for plain text and must answer `pass`.
      const isVerification = typeof init?.body === 'string' && init.body.includes('"responseMimeType":"text/plain"');
      return isVerification
        ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'pass' }] } }] }), { status: 200 })
        : geminiOk('A restyled interpretation.');
    }
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

describe('toTier2ChartPayload', () => {
  it('flattens positions, houses, and aspects into the wire shape', () => {
    expect(toTier2ChartPayload(FIXTURE_CHART)).toEqual({
      positions: [
        { body: SUN, longitude: 14 },
        { body: MOON, longitude: 100 },
      ],
      houses: { cusps: HOUSES.cusps, ascendant: 10, midheaven: 280 },
      aspects: [{ bodyA: SUN, bodyB: MOON, aspectKey: 'trine', separation: 119, orb: 1 }],
    });
  });
});

describe('generateTier2Interpretation', () => {
  it('resolves with the generated sections on a successful response', async () => {
    await setupAdmin();
    const sections = await generateTier2Interpretation({
      mode: 'grounded',
      placementKeys: ['dignity-state:sun:ruler'],
      customPrompt: 'warm and encouraging',
      locale: 'en',
    });
    expect(sections).toEqual([{ heading: 'Overview', body: 'A restyled interpretation.' }]);
  });

  it('sends mode, placementKeys, customPrompt, and locale as the request body in grounded mode', async () => {
    await setupAdmin();
    await generateTier2Interpretation({
      mode: 'grounded',
      placementKeys: ['dignity-state:sun:ruler', 'planet-in-sign:moon:3'],
      customPrompt: 'blunt and direct',
      locale: 'nl',
    });

    const sent = requestBodies.at(-1);
    expect(sent).toEqual({
      mode: 'grounded',
      placementKeys: ['dignity-state:sun:ruler', 'planet-in-sign:moon:3'],
      customPrompt: 'blunt and direct',
      locale: 'nl',
    });
  });

  it('sends mode, chartData, customPrompt, and locale as the request body in freeform mode', async () => {
    await setupAdmin();
    const chartData = toTier2ChartPayload(FIXTURE_CHART);
    await generateTier2Interpretation({ mode: 'freeform', chartData, customPrompt: 'blunt and direct', locale: 'nl' });

    const sent = requestBodies.at(-1);
    expect(sent).toEqual({ mode: 'freeform', chartData, customPrompt: 'blunt and direct', locale: 'nl' });
  });

  it('sends mode, chartData, and locale (no customPrompt) as the request body in synthesis mode (#377)', async () => {
    await setupAdmin();
    const chartData = toTier2ChartPayload(FIXTURE_CHART);
    await generateTier2Interpretation({ mode: 'synthesis', chartData, locale: 'nl' });

    const sent = requestBodies.at(-1);
    expect(sent).toEqual({ mode: 'synthesis', chartData, locale: 'nl' });
  });

  it('throws a Tier2Error carrying the server’s own message and status on a non-2xx response', async () => {
    await setupAdmin();
    await expect(
      generateTier2Interpretation({
        mode: 'grounded',
        placementKeys: [],
        customPrompt: 'warm and encouraging',
        locale: 'en',
      }),
    ).rejects.toMatchObject({
      name: 'Tier2Error',
      status: 400,
      message: 'placementKeys must be a non-empty array',
    });
  });

  it('throws a Tier2Error with status 401 when signed out', async () => {
    await expect(
      generateTier2Interpretation({
        mode: 'grounded',
        placementKeys: ['dignity-state:sun:ruler'],
        customPrompt: 'warm and encouraging',
        locale: 'en',
      }),
    ).rejects.toMatchObject({ name: 'Tier2Error', status: 401 });
  });

  it('carries the rejection code and reason when the verification phase refuses the prompt (#411)', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: 'This instruction violates the allowed customization rules: Asks to invent facts.',
            code: 'customization-rejected',
            reason: 'Asks to invent facts.',
          }),
          { status: 422 },
        ),
      );
    await expect(
      generateTier2Interpretation({
        mode: 'grounded',
        placementKeys: ['dignity-state:sun:ruler'],
        customPrompt: 'make up a few extra placements',
        locale: 'en',
      }),
    ).rejects.toMatchObject({
      name: 'Tier2Error',
      status: 422,
      code: 'customization-rejected',
      reason: 'Asks to invent facts.',
    });
  });

  it('falls back to a generic message when the error response body is not JSON', async () => {
    globalThis.fetch = () => Promise.resolve(new Response('not json', { status: 500 }));
    await expect(
      generateTier2Interpretation({
        mode: 'grounded',
        placementKeys: ['dignity-state:sun:ruler'],
        customPrompt: 'x',
        locale: 'en',
      }),
    ).rejects.toMatchObject({
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
