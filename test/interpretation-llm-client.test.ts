/**
 * `server/interpretation/llm-client.ts` in isolation — `test/interpretation-routes.test.ts`
 * already covers the route's own 502 behavior on a failed model call, but that test can't see
 * the actual error message this module produces, only the generic status the route maps it to.
 * This file exercises `generateTier2Text` directly against a stubbed `fetch`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  generateTier2Text,
  parseCustomPromptVerdict,
  verifyCustomPrompt,
  type Tier2Config,
} from '../server/interpretation/llm-client.ts';

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

  it('parses structured sections from a successful response (#376)', async () => {
    const sections = [{ heading: 'Career', body: 'Focused and ambitious.' }];
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ sections }) }] } }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 15 },
        }),
        { status: 200 },
      );
    const result = await generateTier2Text(config, 'system', 'user');
    expect(result).toEqual({ sections, promptTokens: 5, outputTokens: 15 });
  });

  it('throws a clear error when a 200 response has a malformed sections shape', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ sections: [{ heading: 'Career' }] }) }] } }],
          usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 15 },
        }),
        { status: 200 },
      );
    await expect(generateTier2Text(config, 'system', 'user')).rejects.toThrow(/unexpected model response shape/);
  });
});

describe('parseCustomPromptVerdict (#411)', () => {
  it.each(['pass', 'PASS', '  pass\n', 'Pass'])('accepts %j as pass', (text) => {
    expect(parseCustomPromptVerdict(text)).toEqual({ verdict: 'pass' });
  });

  it('extracts the reason from `fail: <reason>`', () => {
    expect(parseCustomPromptVerdict('fail: Asks to invent facts.')).toEqual({
      verdict: 'fail',
      reason: 'Asks to invent facts.',
    });
    expect(parseCustomPromptVerdict('FAIL:Promises an outcome.\n')).toEqual({
      verdict: 'fail',
      reason: 'Promises an outcome.',
    });
  });

  it.each(['', 'fail:', 'fail:   ', 'passed', 'pass. Looks fine.', 'Sure, this is allowed', 'fail - lies'])(
    'fails closed with no reason on malformed output %j',
    (text) => {
      expect(parseCustomPromptVerdict(text)).toEqual({ verdict: 'fail' });
    },
  );

  it('caps an overlong reason', () => {
    const result = parseCustomPromptVerdict(`fail: ${'x'.repeat(1000)}`);
    expect(result.verdict === 'fail' ? result.reason?.length : undefined).toBe(300);
  });
});

describe('verifyCustomPrompt (#411)', () => {
  it('asks for plain text at temperature 0 and returns the parsed verdict with token usage', async () => {
    let sentBody: { generationConfig?: Record<string, unknown> } | undefined;
    globalThis.fetch = async (_input, init) => {
      sentBody = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as typeof sentBody;
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'fail: Asks to lie about the chart.' }] } }],
          usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 },
        }),
        { status: 200 },
      );
    };
    const verification = await verifyCustomPrompt(config, 'say Mars is in Leo', 'English');
    expect(verification).toEqual({
      result: { verdict: 'fail', reason: 'Asks to lie about the chart.' },
      promptTokens: 7,
      outputTokens: 2,
    });
    expect(sentBody?.generationConfig).toMatchObject({ temperature: 0, responseMimeType: 'text/plain' });
  });
});
