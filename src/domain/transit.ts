/**
 * Computes a transit bi-wheel for one saved person against a chosen moment (#172).
 *
 * "Transit" here means the everyday sense astrologers use it in: the sky right now (or at
 * any other chosen moment), read against a natal chart that stays fixed. That asymmetry is
 * exactly what `fixedSubjects`/`subjectsFrom` (`astrology/aspects.ts`) already model for the
 * M6 progression/return/direction modules — the transiting side is genuinely moving at the
 * target moment, so it uses its own real speed (`subjectsFrom`), while the natal side is a
 * reference being checked against, not itself in motion right now (`fixedSubjects`). This
 * mirrors `secondary-progression.ts`'s `contacts` convention exactly, just with "transiting"
 * standing in for "progressed".
 *
 * The transiting ring is cast for the natal place, not an arbitrary second location — the
 * issue this implements only asks for "current (or arbitrary) time", not a second place, and
 * that also matches how most astrology software casts a transit chart (transiting planets in
 * the houses of *this* birthplace, or of wherever the reading is being done from — Astraya has
 * no other place on record for a saved person than their birth coordinates).
 *
 * Both rings are full `ChartData` (not just positions), so any existing table, wheel or sheet
 * helper built for a single chart's `ChartData` works unchanged for either ring here.
 */
import { findCrossAspects, fixedSubjects, subjectsFrom, type Aspect, type OrbConfig } from '../astrology/aspects.js';
import { bodyById, type BodyCategory } from '../astrology/bodies.js';
import {
  computeChartData,
  computeChartDataAtJd,
  type ChartCalculationOptions,
  type ChartData,
} from './chart-compute.js';
import type { BodyId, EphemerisProvider, GeoPosition, JulianDayUT } from '../ephemeris/types.js';
import type { BirthMomentInput } from '../time/types.js';

function categoryOf(body: BodyId): BodyCategory {
  const definition = bodyById(body);
  if (definition === undefined) throw new Error(`unreachable: ${String(body)} is always one of BODIES`);
  return definition.category;
}

export interface TransitData {
  readonly natal: ChartData;
  readonly transit: ChartData;
  /** Aspects from the transiting positions (moving) to the fixed natal chart. */
  readonly contacts: readonly Aspect[];
}

/**
 * `provider` must already be initialized. `targetJd` is the moment being transited *to* —
 * defaulting to now is the caller's job (same division of responsibility as
 * `computeSecondaryProgression`'s `targetJd`), and any Julian day is valid, including one
 * before birth.
 */
export async function computeTransit(
  natalMoment: BirthMomentInput,
  targetJd: JulianDayUT,
  provider: EphemerisProvider,
  options: ChartCalculationOptions = {},
  orbConfig?: OrbConfig,
): Promise<TransitData> {
  const place: GeoPosition = { ...natalMoment.coordinates, altitude: 0 };
  const [natal, transit] = await Promise.all([
    computeChartData(natalMoment, provider, options),
    computeChartDataAtJd(targetJd, place, provider, options),
  ]);

  const contacts = findCrossAspects(
    subjectsFrom(transit.positions, categoryOf),
    fixedSubjects(natal.positions, categoryOf),
    orbConfig,
  );

  return { natal, transit, contacts };
}
