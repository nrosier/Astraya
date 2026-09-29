/**
 * Hosted OpenAI-compatible gateway client ("ICA"), for #368's local-vs-hosted
 * comparison — base URL and model come from ASTRAYA_ICA_BASE_URL/ASTRAYA_ICA_MODEL
 * rather than being hardcoded, since this is one particular internal gateway
 * among many possible OpenAI-compatible endpoints a future comparison might
 * point at. Namespaced ASTRAYA_-prefixed, unlike this repo's other provider env
 * vars: a bare ICA_API_KEY collided with one already exported in this
 * machine's own shell profile (`--env-file` never overrides an
 * already-set variable), which silently shadowed the real value from
 * .env.local and surfaced as a confusing "Unknown icaKey" error.
 *
 * Confirmed live 2026-09-29: this gateway is a LiteLLM proxy in front of many
 * different backend models, reached via `{baseUrl}/chat-models/chat/completions`
 * (not the more conventional `/chat/completions` — that path 401s here regardless
 * of key validity, since it isn't routed to the proxy at all).
 *
 * Unlike gemini.mjs/ollama.mjs, this gateway's structured-output support is
 * unverified across the models it proxies, so instead of relying on a native
 * schema field, the schema is spelled out in the system prompt and
 * `response_format: { type: 'json_object' }` is sent as a soft constraint.
 * `extractJson` strips a markdown code fence if the model wraps its JSON in one
 * despite the instruction not to.
 *
 * max_tokens is set high (not the small per-request default many OpenAI-style
 * APIs use): reasoning models proxied here (e.g. gemma-4-26b-a4b-it) spend
 * tokens on a `reasoning_content`/`thinking_blocks` preamble before the real
 * answer, observed directly while testing this gateway — a low cap truncates
 * before any real content and leaves `content: null`.
 */

const DEFAULT_BASE_URL = 'https://api.servicesessentials.ibm.com/v1';
const DEFAULT_MAX_TOKENS = 2048;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function schemaAsInstruction(responseSchema) {
  return [
    'Respond with a single JSON object and nothing else — no markdown code fence, no commentary before or after it.',
    `It must validate against this JSON Schema: ${JSON.stringify(responseSchema)}`,
  ].join('\n');
}

function extractJson(content) {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

/**
 * One structured-output request against the hosted gateway. Returns the
 * parsed JSON object the model produced.
 */
export async function generateStructured({
  apiKey,
  model,
  baseUrl,
  temperature,
  systemInstruction,
  userContent,
  responseSchema,
  maxRetries = 3,
  onUsage,
}) {
  if (!apiKey) throw new Error('ASTRAYA_ICA_API_KEY is not set — check .env.local');
  if (!model) throw new Error('ASTRAYA_ICA_MODEL is not set — check .env.local');

  const url = `${baseUrl || DEFAULT_BASE_URL}/chat-models/chat/completions`;
  const body = {
    model,
    messages: [
      { role: 'system', content: `${systemInstruction}\n\n${schemaAsInstruction(responseSchema)}` },
      { role: 'user', content: userContent },
    ],
    temperature,
    max_tokens: Number(process.env.ASTRAYA_ICA_MAX_TOKENS) || DEFAULT_MAX_TOKENS,
    response_format: { type: 'json_object' },
  };

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
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
      const choice = payload.choices?.[0];
      const content = choice?.message?.content;
      if (typeof content !== 'string' || content.length === 0) {
        throw new Error(
          `unexpected response shape (finish_reason: ${String(choice?.finish_reason)}): ${JSON.stringify(payload).slice(0, 500)}`,
        );
      }
      onUsage?.({
        promptTokenCount: payload.usage?.prompt_tokens,
        candidatesTokenCount: payload.usage?.completion_tokens,
      });
      return JSON.parse(extractJson(content));
    }

    const errorBody = await response.text();
    lastError = new Error(`ICA API ${String(response.status)}: ${errorBody.slice(0, 1000)}`);
    if (!RETRYABLE_STATUS.has(response.status) || attempt === maxRetries) throw lastError;
    await sleep(2 ** attempt * 1000);
  }
  throw lastError;
}
