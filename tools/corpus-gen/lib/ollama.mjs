/**
 * Local Ollama client for #359: the same `generateStructured` shape
 * `lib/gemini.mjs` exports, so `generate-batch.mjs`/`generate-sample.mjs`
 * can select a backend with one flag rather than a rewrite — exactly the
 * provider-swap `gemini.mjs`'s own doc comment anticipated.
 *
 * Ollama's `format` field already accepts a plain (lower-case-typed) JSON
 * Schema, unlike Gemini's upper-case `Schema` type, so `responseSchema` is
 * passed through unchanged — no `toGeminiSchema`-style conversion needed.
 *
 * No `apiKey`: Ollama is a local server on `localhost`, not a hosted API.
 * Retries mirror `gemini.mjs`'s: network errors and 5xx are retried
 * (a model still loading into memory on first call looks like this), other
 * failures surface immediately.
 */

const DEFAULT_BASE_URL = 'http://localhost:11434';
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One structured-output request against a local Ollama server. Returns the
 * parsed JSON object the model produced, constrained to `responseSchema`.
 */
export async function generateStructured({
  model,
  baseUrl,
  temperature,
  systemInstruction,
  userContent,
  responseSchema,
  maxRetries = 3,
  onUsage,
}) {
  if (!model) throw new Error('OLLAMA_MODEL is not set — check .env.local');

  const url = `${baseUrl || DEFAULT_BASE_URL}/api/chat`;
  const body = {
    model,
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: userContent },
    ],
    format: responseSchema,
    stream: false,
    options: { temperature },
  };

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (networkError) {
      lastError = networkError;
      if (attempt === maxRetries) throw networkError;
      await sleep(2 ** attempt * 1000);
      continue;
    }

    if (response.ok) {
      const payload = await response.json();
      const content = payload.message?.content;
      if (typeof content !== 'string') {
        throw new Error(`unexpected response shape: ${JSON.stringify(payload).slice(0, 500)}`);
      }
      onUsage?.({ promptTokenCount: payload.prompt_eval_count, candidatesTokenCount: payload.eval_count });
      return JSON.parse(content);
    }

    const errorBody = await response.text();
    lastError = new Error(`Ollama API ${String(response.status)}: ${errorBody.slice(0, 1000)}`);
    if (!RETRYABLE_STATUS.has(response.status) || attempt === maxRetries) throw lastError;
    await sleep(2 ** attempt * 1000);
  }
  throw lastError;
}
