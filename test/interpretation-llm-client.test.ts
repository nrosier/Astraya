/**
 * `server/interpretation/llm-client.ts` in isolation — `test/interpretation-routes.test.ts`
 * already covers the route's own 502 behavior on a failed model call, but that test can't see
 * the actual error message this module produces, only the generic status the route maps it to.
 * This file exercises `generateTier2Text` directly against a stubbed `fetch`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { generateTier2Text, type Tier2Config } from '../server/interpretation/llm-client.ts';

const realFetch = globalThis.fetch;
const config: Tier2Config = { apiKey: 'test-key', model: 'gemini-9000-typo', baseUrl: 'https://example.invalid' };

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('generateTier2Text', () => {
  it('names the configured model in the error when the endpoint 404s', async () => {
    globalThis.fetch = async () => new Response('', { status: 404 });
    await expect(generateTier2Text(config, 'system', 'user')).rejects.toThrow(
      /model "gemini-9000-typo" not found; check ASTRAYA_INTERPRETATION_MODEL/,
    );
  });

  it('does not retry a 404 (it is not a transient failure)', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      return new Response('', { status: 404 });
    };
    await expect(generateTier2Text(config, 'system', 'user')).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it('does not add the model hint for a non-404 failure', async () => {
    globalThis.fetch = async () => new Response('server error', { status: 400 });
    await expect(generateTier2Text(config, 'system', 'user')).rejects.toThrow(
      'Tier 2 model call failed (400): server error',
    );
  });
});
