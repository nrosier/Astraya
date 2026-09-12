/**
 * Computes a synastry bi-wheel comparing two people's natal charts (#172).
 *
 * Synastry is not a fixed-reference-versus-moving comparison the way a transit, progression
 * or return is: both charts are equally "real" natal moments, neither one a reference frame
 * the other moves against. `astrology/aspects.ts`'s `fixedSubjects` exists precisely to zero
 * out a side's own speed so it doesn't leak into the applying/separating calculation for a
 * side that is genuinely moving *right now* — that reasoning has no side to attach to here,
 * since neither person's chart is "now" relative to the other. Both sides therefore use
 * `subjectsFrom` (each chart's own real, natal speed), unlike every M6 cross-chart caller and
 * unlike this same issue's `transit.ts`, which does have that asymmetry and uses
 * `fixedSubjects` for its natal side accordingly.
 *
 * Both charts are full `ChartData`, computed independently — nothing here assumes the two
 * people share a place or time, and nothing about one chart's own dignities, sect or angles
 * depends on the other's.
 */
import { findCrossAspects, subjectsFrom, type Aspect, type OrbConfig } from '../astrology/aspects.js';
import { bodyById, type BodyCategory } from '../astrology/bodies.js';
import { computeChartData, type ChartCalculationOptions, type ChartData } from './chart-compute.js';
import type { BodyId, EphemerisProvider } from '../ephemeris/types.js';
import type { BirthMomentInput } from '../time/types.js';

function categoryOf(body: BodyId): BodyCategory {
  const definition = bodyById(body);
  if (definition === undefined) throw new Error(`unreachable: ${String(body)} is always one of BODIES`);
  return definition.category;
}

export interface SynastryData {
  readonly chartA: ChartData;
  readonly chartB: ChartData;
  /** Every aspect between a body in A's chart and a body in B's chart, both at real speed. */
  readonly aspects: readonly Aspect[];
}

/** `provider` must already be initialized. Both moments are resolved and computed independently. */
export async function computeSynastry(
  momentA: BirthMomentInput,
  momentB: BirthMomentInput,
  provider: EphemerisProvider,
  options: ChartCalculationOptions = {},
  orbConfig?: OrbConfig,
): Promise<SynastryData> {
  const [chartA, chartB] = await Promise.all([
    computeChartData(momentA, provider, options),
    computeChartData(momentB, provider, options),
  ]);

  const aspects = findCrossAspects(
    subjectsFrom(chartA.positions, categoryOf),
    subjectsFrom(chartB.positions, categoryOf),
    orbConfig,
  );

  return { chartA, chartB, aspects };
}
