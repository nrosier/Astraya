/**
 * Gemini Batch API client: same structured-output contract as
 * generateStructured() in gemini.mjs, but asynchronous and billed at 50% of
 * standard rates — Google processes a whole array of requests as one job
 * instead of one HTTP call per entry. A separate file, not folded into
 * gemini.mjs, because the shapes are incompatible top to bottom: one
 * request/one response vs submit-many/poll-until-done/retrieve-many.
 *
 * Inline requests only, not the File API's JSONL-upload path: Google caps
 * an inline batch payload at 20MB, which comfortably covers every
 * locale/persona scope generate-batch.mjs actually runs (at most a few
 * thousand placements) without needing a resumable-upload protocol on top
 * of what gemini.mjs already does. `submitBatch` throws before sending if a
 * payload would exceed that cap (with margin) — split the run with
 * `--limit` if that ever happens.
 *
 * Each inline request carries a `metadata.key` round-tripped back on its
 * own response, so results are matched back to the placement that asked for
 * them by that key, not by array position — the API does not guarantee
 * response order matches request order.
 */
import { toGeminiSchema, DEFAULT_BASE_URL } from './gemini.mjs';

const MAX_INLINE_BYTES = 18 * 1024 * 1024; // Google's own cap is 20MB; this leaves margin.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
// Confirmed against a real batch job, not just docs — the public docs page describes this enum
// as "JOB_STATE_*", but the API itself actually returns "BATCH_STATE_*".
const TERMINAL_STATES = new Set([
  'BATCH_STATE_SUCCEEDED',
  'BATCH_STATE_FAILED',
  'BATCH_STATE_CANCELLED',
  'BATCH_STATE_EXPIRED',
]);

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options, maxRetries) {
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (networkError) {
      lastError = networkError;
      if (attempt === maxRetries) throw networkError;
      await sleep(2 ** attempt * 1000);
      continue;
    }
    if (response.ok) return response;
    const errorBody = await response.text();
    lastError = new Error(`Gemini batch API ${String(response.status)}: ${errorBody.slice(0, 1000)}`);
    if (!RETRYABLE_STATUS.has(response.status) || attempt === maxRetries) throw lastError;
    await sleep(2 ** attempt * 1000);
  }
  throw lastError;
}

/** Builds one inline batch request entry — `key` is this placement's own corpus key. */
export function buildBatchRequest({ key, systemInstruction, userContent, temperature, responseSchema }) {
  return {
    metadata: { key },
    request: {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      generationConfig: {
        temperature,
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(responseSchema),
      },
    },
  };
}

/** Submits an inline batch job. Returns the initial long-running-operation object (not yet done). */
export async function submitBatch({ apiKey, baseUrl, model, displayName, requests, maxRetries = 3 }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set — check .env.local');
  if (!model) throw new Error('GEMINI_MODEL is not set — check .env.local');

  const payload = JSON.stringify({
    batch: { display_name: displayName, input_config: { requests: { requests } } },
  });
  const payloadBytes = Buffer.byteLength(payload, 'utf8');
  if (payloadBytes > MAX_INLINE_BYTES) {
    throw new Error(
      `batch payload is ${(payloadBytes / 1024 / 1024).toFixed(1)}MB, over Gemini's inline batch cap — ` +
        're-run with a smaller --limit to split this into multiple batches',
    );
  }

  const url = `${baseUrl || DEFAULT_BASE_URL}/v1beta/models/${model}:batchGenerateContent`;
  const response = await fetchWithRetry(
    url,
    { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }, body: payload },
    maxRetries,
  );
  return response.json();
}

/** Fetches a batch job's current operation with a single request — no loop, no blocking wait. */
export async function getBatch({ apiKey, baseUrl, name, maxRetries = 3 }) {
  const url = `${baseUrl || DEFAULT_BASE_URL}/v1beta/${name}`;
  const response = await fetchWithRetry(url, { headers: { 'x-goog-api-key': apiKey } }, maxRetries);
  return response.json();
}

/** Whether a batch operation has reached a terminal state (not necessarily success). */
export function isBatchTerminal(operation) {
  return operation.done === true || TERMINAL_STATES.has(operation.metadata?.state);
}

/**
 * Polls a batch job until it reaches a terminal state. `onPoll(state)` fires after every poll,
 * including the first, so a caller can show progress across what the API itself documents as
 * usually minutes, sometimes up to its own 48-hour hard expiry.
 */
export async function pollBatch({ apiKey, baseUrl, name, intervalMs = 15000, onPoll, maxRetries = 3 }) {
  for (;;) {
    const operation = await getBatch({ apiKey, baseUrl, name, maxRetries });
    onPoll?.(operation.metadata?.state);
    if (isBatchTerminal(operation)) return operation;
    await sleep(intervalMs);
  }
}

/**
 * Normalizes a finished batch job's results into one `{ key, result, usage }` or
 * `{ key, error }` per request, keyed by each request's own `metadata.key` — never by position.
 */
export function extractBatchResults(operation) {
  const state = operation.metadata?.state;
  if (state !== 'BATCH_STATE_SUCCEEDED') {
    throw new Error(
      `batch job ended in state ${String(state)}, not BATCH_STATE_SUCCEEDED: ` +
        JSON.stringify(operation.error ?? operation.metadata ?? {}).slice(0, 500),
    );
  }
  // Confirmed against a real batch job: results live at response.inlinedResponses.inlinedResponses
  // — one more layer of nesting than the public docs page's own example shows.
  const inlined = operation.response?.inlinedResponses?.inlinedResponses ?? [];
  return inlined.map((item) => {
    const key = item.metadata?.key;
    if (item.error) return { key, error: new Error(item.error.message ?? JSON.stringify(item.error)) };
    const text = item.response?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') return { key, error: new Error('unexpected response shape') };
    try {
      return { key, result: JSON.parse(text), usage: item.response?.usageMetadata };
    } catch (parseError) {
      return { key, error: parseError };
    }
  });
}
