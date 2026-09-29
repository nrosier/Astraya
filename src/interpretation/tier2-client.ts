/**
 * Thin `fetch()` wrapper for `POST /api/interpretation/generate`
 * (`server/interpretation-routes.ts`), the one runtime path in Astraya that
 * calls a third-party model provider — proxied entirely through the server,
 * per ADR 0003. Same shape as `admin-client.ts`: nothing here interprets a
 * response beyond its own shape, and every rejection carries the server's
 * own message.
 *
 * Takes `placementKeys` (from `report.ts`'s `reportPlacementKeys`) rather
 * than the chart or corpus text itself — the server re-resolves each key's
 * grounded Tier-1 text against its own copy of the corpus, so no
 * interpretation prose crosses the wire from the client at all, only the
 * de-identified placement keys already safe to send per ADR 0003's
 * structural PII-minimization.
 *
 * `locale` is sent alongside them so the server resolves each key's
 * grounded Tier-1 text in the language the report is already showing —
 * itself locale-agnostic data (`schema.ts`'s canonical body/aspect ids),
 * not the birth data the placement keys are already scoped to exclude.
 */
import type { Locale } from './schema.js';

export class Tier2Error extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'Tier2Error';
    this.status = status;
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    /* fall through to the generic message below */
  }
  return `Request failed with status ${String(response.status)}`;
}

/** Hand-mirrors `server/interpretation/llm-client.ts`'s `Tier2Section` — no shared schema library between client and server. */
export interface Tier2Section {
  readonly heading: string;
  readonly body: string;
}

/** Generates one Tier-2, AI-customized interpretation for the given placements and free-text style instructions. */
export async function generateTier2Interpretation(
  placementKeys: readonly string[],
  customPrompt: string,
  locale: Locale,
): Promise<readonly Tier2Section[]> {
  const response = await fetch('/api/interpretation/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ placementKeys, customPrompt, locale }),
  });
  if (!response.ok) throw new Tier2Error(await errorMessage(response), response.status);
  const { sections } = (await response.json()) as { sections: readonly Tier2Section[] };
  return sections;
}
