/**
 * Tier 2's real provider credential and model call (#360) — the one place
 * in the whole server that reaches a third-party LLM. Never imported by
 * anything under `src/`; `test/no-runtime-llm-access.test.ts` enforces that
 * boundary the same way it already does for the corpus-gen provider keys.
 *
 * Deliberately not `tools/corpus-gen/lib/gemini.mjs`: that module is
 * structured-output-only (a JSON schema every call must conform to, for a
 * fixed corpus-entry shape) and build-time-only (no request budget, no
 * per-user caller). This call wants free-form prose back and runs inside a
 * live HTTP request, so it gets its own minimal client rather than
 * stretching that one to cover both.
 */
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface Tier2Config {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
}

/** `undefined` when Tier 2 isn't configured (no API key) — the route treats that as "disabled", not an error. */
export function loadTier2Config(env: NodeJS.ProcessEnv = process.env): Tier2Config | undefined {
  const apiKey = env.ASTRAYA_INTERPRETATION_API_KEY;
  if (apiKey === undefined || apiKey === '') return undefined;
  return {
    apiKey,
    model:
      env.ASTRAYA_INTERPRETATION_MODEL === undefined || env.ASTRAYA_INTERPRETATION_MODEL === ''
        ? 'gemini-2.5-flash'
        : env.ASTRAYA_INTERPRETATION_MODEL,
    baseUrl:
      env.ASTRAYA_INTERPRETATION_BASE_URL === undefined || env.ASTRAYA_INTERPRETATION_BASE_URL === ''
        ? DEFAULT_BASE_URL
        : env.ASTRAYA_INTERPRETATION_BASE_URL,
  };
}

export interface Tier2Result {
  readonly text: string;
  readonly promptTokens: number;
  readonly outputTokens: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface GeminiResponse {
  readonly candidates?: readonly {
    readonly content?: { readonly parts?: readonly { readonly text?: string }[] };
  }[];
  readonly usageMetadata?: { readonly promptTokenCount?: number; readonly candidatesTokenCount?: number };
}

/**
 * One free-form-text generation call. Retries on 5xx/429 (transient, per
 * `gemini.mjs`'s own notes), surfaces 4xx immediately — those are almost
 * always a config problem retrying won't fix.
 */
export async function generateTier2Text(
  config: Tier2Config,
  systemInstruction: string,
  userContent: string,
  maxRetries = 2,
): Promise<Tier2Result> {
  const url = `${config.baseUrl}/v1beta/models/${config.model}:generateContent`;
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: userContent }] }],
    generationConfig: { temperature: 0.7 },
  };

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
        body: JSON.stringify(body),
      });
    } catch (networkError) {
      lastError = networkError instanceof Error ? networkError : new Error(String(networkError));
      if (attempt === maxRetries) throw lastError;
      await sleep(2 ** attempt * 500);
      continue;
    }

    if (response.ok) {
      const payload = (await response.json()) as GeminiResponse;
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof text !== 'string') {
        throw new Error(`Tier 2: unexpected model response shape: ${JSON.stringify(payload).slice(0, 500)}`);
      }
      return {
        text,
        promptTokens: payload.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
      };
    }

    const errorBody = await response.text();
    // Google returns a bare, often-empty-bodied 404 for an unknown model id — the single most
    // likely cause being a typo or a retired model in ASTRAYA_INTERPRETATION_MODEL (or its
    // hardcoded default above), not a transient issue. Name that suspect explicitly so it shows
    // up in the server log instead of a bare "(404): " that gives the operator nothing to act on.
    const hint =
      response.status === 404
        ? ` — model "${config.model}" not found; check ASTRAYA_INTERPRETATION_MODEL for a typo or a retired model id`
        : '';
    lastError = new Error(`Tier 2 model call failed (${String(response.status)}): ${errorBody.slice(0, 1000)}${hint}`);
    if (!RETRYABLE_STATUS.has(response.status) || attempt === maxRetries) throw lastError;
    await sleep(2 ** attempt * 500);
  }
  throw lastError ?? new Error('Tier 2 model call failed for an unknown reason.');
}

/**
 * Approximate Gemini 2.5 Flash pricing (USD per 1M tokens, text-only) —
 * verify against https://ai.google.dev/gemini-api/docs/pricing before
 * relying on this for a real budget; it exists to give the daily-cap check
 * in `server/interpretation/usage.ts` a real number to compare against, not
 * to be an exact invoice.
 */
const INPUT_COST_PER_1M_CENTS = 7.5;
const OUTPUT_COST_PER_1M_CENTS = 30;

export function estimateCostCents(promptTokens: number, outputTokens: number): number {
  return (promptTokens * INPUT_COST_PER_1M_CENTS + outputTokens * OUTPUT_COST_PER_1M_CENTS) / 1_000_000;
}
