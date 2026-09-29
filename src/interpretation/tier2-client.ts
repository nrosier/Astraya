/**
 * Thin `fetch()` wrapper for `POST /api/interpretation/generate`
 * (`server/interpretation-routes.ts`), the one runtime path in Astraya that
 * calls a third-party model provider — proxied entirely through the server,
 * per ADR 0003. Same shape as `admin-client.ts`: nothing here interprets a
 * response beyond its own shape, and every rejection carries the server's
 * own message.
 *
 * Two modes, see ADR 0003:
 * - `'grounded'` sends `placementKeys` (from `report.ts`'s
 *   `reportPlacementKeys`) rather than the chart or corpus text itself — the
 *   server re-resolves each key's grounded Tier-1 text against its own copy
 *   of the corpus, so no interpretation prose crosses the wire from the
 *   client at all, only the de-identified placement keys already safe to
 *   send per ADR 0003's structural PII-minimization, and the model only
 *   restyles that given text.
 * - `'freeform'` sends `chartData` (computed positions/houses/aspects — see
 *   `toTier2ChartPayload`) and lets the model originate its own
 *   interpretation from it. This deliberately gives up grounded mode's
 *   "no chart data crosses the wire" guarantee for this mode only; ADR 0003
 *   documents the tradeoff.
 *
 * `locale` is sent alongside either payload so the server responds in the
 * language the report is already showing.
 */
import type { ChartData } from '../domain/chart-compute.js';
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

/**
 * Hand-mirrors `server/interpretation-routes.ts`'s `chartData` validation
 * shape for freeform mode. Deliberately a subset of `ChartData` — only
 * `positions`/`houses`/`aspects`, not `dignities`/`sect`/`partOfFortune`/
 * `partOfSpirit`, which freeform mode doesn't send.
 */
export interface Tier2ChartDataPayload {
  readonly positions: readonly { readonly body: number; readonly longitude: number }[];
  readonly houses: { readonly cusps: readonly number[]; readonly ascendant: number; readonly midheaven: number };
  readonly aspects: readonly {
    readonly bodyA: number;
    readonly bodyB: number;
    readonly aspectKey: string;
    readonly separation: number;
    readonly orb: number;
  }[];
}

/** Flattens a computed `ChartData` into freeform mode's wire payload. */
export function toTier2ChartPayload(chart: ChartData): Tier2ChartDataPayload {
  return {
    positions: chart.positions.map((position) => ({ body: position.body, longitude: position.longitude })),
    houses: {
      cusps: chart.houses.cusps,
      ascendant: chart.houses.ascendant,
      midheaven: chart.houses.midheaven,
    },
    aspects: chart.aspects.map((aspect) => ({
      bodyA: aspect.bodyA,
      bodyB: aspect.bodyB,
      aspectKey: aspect.aspect.key,
      separation: aspect.separation,
      orb: aspect.orb,
    })),
  };
}

export type Tier2Request =
  | {
      readonly mode: 'grounded';
      readonly placementKeys: readonly string[];
      readonly customPrompt: string;
      readonly locale: Locale;
    }
  | {
      readonly mode: 'freeform';
      readonly chartData: Tier2ChartDataPayload;
      readonly customPrompt: string;
      readonly locale: Locale;
    };

/** Generates one Tier-2, AI-customized interpretation for the given request. */
export async function generateTier2Interpretation(request: Tier2Request): Promise<readonly Tier2Section[]> {
  const response = await fetch('/api/interpretation/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) throw new Tier2Error(await errorMessage(response), response.status);
  const { sections } = (await response.json()) as { sections: readonly Tier2Section[] };
  return sections;
}
