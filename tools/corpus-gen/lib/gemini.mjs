/**
 * Minimal Gemini/AI Studio client for #56. Model-agnostic in spirit — this
 * file is the one place that knows the wire format — but only Gemini is
 * implemented today, per "any provider with structured output" being a
 * later swap, not a today requirement.
 *
 * Retries on 5xx (observed as normal during testing per #56's own notes,
 * not a reason to abort a batch) and surfaces 4xx immediately, since those
 * are almost always a config problem (bad key, unfunded billing on a
 * paid-tier model) that retrying will not fix.
 */

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Gemini's Schema type wants upper-case type names; schema.ts's is lower-case JSON Schema. */
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== 'object') return schema;
  const out = {};
  for (const [key, value] of Object.entries(schema)) {
    out[key] = key === 'type' && typeof value === 'string' ? value.toUpperCase() : toGeminiSchema(value);
  }
  return out;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One structured-output request. Returns the parsed JSON object the model
 * produced, already validated against `responseSchema` by the API itself.
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
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set — check .env.local');
  if (!model) throw new Error('GEMINI_MODEL is not set — check .env.local');

  const url = `${baseUrl || DEFAULT_BASE_URL}/v1beta/models/${model}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      responseSchema: toGeminiSchema(responseSchema),
    },
  };

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
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
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') {
        throw new Error(`unexpected response shape: ${JSON.stringify(payload).slice(0, 500)}`);
      }
      onUsage?.(payload.usageMetadata);
      return JSON.parse(text);
    }

    const errorBody = await response.text();
    lastError = new Error(`Gemini API ${String(response.status)}: ${errorBody.slice(0, 1000)}`);
    if (!RETRYABLE_STATUS.has(response.status) || attempt === maxRetries) throw lastError;
    await sleep(2 ** attempt * 1000);
  }
  throw lastError;
}
