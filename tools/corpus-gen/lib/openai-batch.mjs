/**
 * OpenAI Batch API client: this project's second batch-provider client, after
 * gemini-batch.mjs — not merged into it, since the wire shapes have nothing in
 * common beyond both being "submit many, poll, retrieve many." Billed at 50%
 * of OpenAI's standard per-token rates, same discount shape as Gemini's.
 *
 * Unlike Gemini's inline-requests batch mode (gemini-batch.mjs), OpenAI's
 * Batch API has no inline path at all — every batch is a JSONL file: upload
 * it via the Files API (`purpose: "batch"`), then create a batch job that
 * references the returned file id. Results come back the same way: a second
 * JSONL file, downloaded once the job finishes, with one line per request
 * keyed by that request's own `custom_id` — "the output line order may not
 * match the input line order" per OpenAI's own docs, so this never assumes
 * it does.
 *
 * Structured outputs use plain JSON Schema (`response_format.json_schema`),
 * not Gemini's own upper-cased `Schema` dialect — no case-transform helper
 * needed here the way gemini.mjs's `toGeminiSchema` is for Gemini.
 */
const DEFAULT_BASE_URL = 'https://api.openai.com';
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'expired', 'cancelled']);

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
    lastError = new Error(`OpenAI batch API ${String(response.status)}: ${errorBody.slice(0, 1000)}`);
    if (!RETRYABLE_STATUS.has(response.status) || attempt === maxRetries) throw lastError;
    await sleep(2 ** attempt * 1000);
  }
  throw lastError;
}

/** Builds one JSONL line of the batch input file — `customId` is this placement's own corpus key. */
export function buildBatchRequest({
  customId,
  model,
  systemInstruction,
  userContent,
  temperature,
  responseSchema,
  schemaName,
}) {
  return {
    custom_id: customId,
    method: 'POST',
    url: '/v1/chat/completions',
    body: {
      model,
      temperature,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContent },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name: schemaName ?? 'response', strict: true, schema: responseSchema },
      },
    },
  };
}

/**
 * Uploads `requests` as one JSONL file and creates a batch job against it. No inline-request
 * size cap to enforce here the way gemini-batch.mjs has — OpenAI's file-upload path (the only
 * path it has) is already good for up to 200MB / 50,000 requests per their own documented limits,
 * comfortably more than any locale/persona scope this project runs.
 */
export async function submitBatch({ apiKey, baseUrl, requests, maxRetries = 3 }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set — check .env.local');

  const jsonl = requests.map((request) => JSON.stringify(request)).join('\n');
  const form = new FormData();
  form.append('purpose', 'batch');
  form.append('file', new Blob([jsonl], { type: 'application/jsonl' }), 'batch.jsonl');

  const uploadResponse = await fetchWithRetry(
    `${baseUrl || DEFAULT_BASE_URL}/v1/files`,
    { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form },
    maxRetries,
  );
  const uploaded = await uploadResponse.json();

  const createResponse = await fetchWithRetry(
    `${baseUrl || DEFAULT_BASE_URL}/v1/batches`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ input_file_id: uploaded.id, endpoint: '/v1/chat/completions', completion_window: '24h' }),
    },
    maxRetries,
  );
  return createResponse.json();
}

/** Polls a batch job until it reaches a terminal status. `onPoll(status)` fires after every poll. */
export async function pollBatch({ apiKey, baseUrl, batchId, intervalMs = 15000, onPoll, maxRetries = 3 }) {
  const url = `${baseUrl || DEFAULT_BASE_URL}/v1/batches/${batchId}`;
  for (;;) {
    const response = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${apiKey}` } }, maxRetries);
    const batch = await response.json();
    onPoll?.(batch.status, batch.request_counts);
    if (TERMINAL_STATUSES.has(batch.status)) return batch;
    await sleep(intervalMs);
  }
}

/**
 * Normalizes a finished batch job's results into one `{ customId, result, usage }` or
 * `{ customId, error }` per request, keyed by each request's own `custom_id` — the API's own
 * docs say output line order is not guaranteed to match input order.
 */
export async function extractBatchResults({ apiKey, baseUrl, batch }) {
  if (batch.status !== 'completed') {
    throw new Error(
      `batch job ended in status ${String(batch.status)}, not completed: ${JSON.stringify(batch.errors ?? {}).slice(0, 500)}`,
    );
  }
  if (batch.output_file_id === null || batch.output_file_id === undefined) {
    return []; // every request errored — see error_file_id, surfaced by the caller if it checks
  }
  const response = await fetchWithRetry(
    `${baseUrl || DEFAULT_BASE_URL}/v1/files/${batch.output_file_id}/content`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
    3,
  );
  const text = await response.text();
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const parsed = JSON.parse(line);
      const customId = parsed.custom_id;
      if (parsed.error) return { customId, error: new Error(parsed.error.message ?? JSON.stringify(parsed.error)) };
      if (parsed.response?.status_code !== 200) {
        return {
          customId,
          error: new Error(
            `HTTP ${String(parsed.response?.status_code)}: ${JSON.stringify(parsed.response?.body).slice(0, 500)}`,
          ),
        };
      }
      const content = parsed.response.body?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') return { customId, error: new Error('unexpected response shape') };
      try {
        return { customId, result: JSON.parse(content), usage: parsed.response.body?.usage };
      } catch (parseError) {
        return { customId, error: parseError };
      }
    });
}
