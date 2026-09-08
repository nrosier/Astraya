/**
 * Computes a tertiary or minor progression for a target date (#48).
 *
 * Structurally the same as `computeSecondaryProgression`, aside from how the
 * progressed Julian day is derived (`minorProgressedJulianDay`, which picks
 * between the two techniques' distinct substitution formulas) and that
 * houses are always recomputed directly at that moment — the equivalent of
 * secondary's `'quotidian'` MC method — since neither tertiary nor minor has
 * a symbolic-arc school the way secondary does. Named `computeMinorProgression`
 * with an explicit `method` rather than two near-identical functions, to keep
 * the "day-for-lunar-month" and "lunar-month-for-year" cases from drifting
 * apart in behaviour by construction, not just by convention — and to avoid
 * any name that could be confused with `computeSecondaryProgression` itself.
 */
import { BODIES } from '../astrology/bodies.js';
import { minorProgressedJulianDay, type MinorProgressionMethod } from '../astrology/minor-progressions.js';
import { ageInYears } from '../astrology/progressions.js';
import { julianDayFor } from '../time/julian.js';
import { resolveMoment } from '../time/resolve.js';
import type {
  BodyPosition,
  EphemerisProvider,
  GeoPosition,
  HousePositions,
  HouseSystem,
  JulianDayUT,
  Zodiac,
} from '../ephemeris/types.js';
import type { BirthMomentInput } from '../time/types.js';

/** Placidus, matching `chart-compute.ts` and `secondary-progression.ts`'s default. */
const DEFAULT_HOUSE_SYSTEM: HouseSystem = 'P';

export interface MinorProgressionOptions {
  readonly houseSystem?: HouseSystem;
  readonly zodiac?: Zodiac;
}

export interface MinorProgressionData {
  readonly method: MinorProgressionMethod;
  readonly natalJd: JulianDayUT;
  readonly progressedJd: JulianDayUT;
  readonly ageInYears: number;
  readonly positions: readonly BodyPosition[];
  readonly houses: HousePositions;
}

/**
 * `provider` must already be initialized. `targetJd` is the moment being
 * progressed *to* — see `computeSecondaryProgression`'s doc comment on the
 * same parameter for why a Julian day rather than a civil date.
 */
export async function computeMinorProgression(
  method: MinorProgressionMethod,
  natalMoment: BirthMomentInput,
  targetJd: JulianDayUT,
  provider: EphemerisProvider,
  options: MinorProgressionOptions = {},
): Promise<MinorProgressionData> {
  const resolved = resolveMoment(natalMoment);
  const natalJd = await julianDayFor(provider, resolved);
  const place: GeoPosition = { ...natalMoment.coordinates, altitude: 0 };
  const houseSystem = options.houseSystem ?? DEFAULT_HOUSE_SYSTEM;
  const positionOptions = options.zodiac === undefined ? undefined : { zodiac: options.zodiac };

  const progressedJd = minorProgressedJulianDay(method, natalJd, targetJd);
  const [positions, houses] = await Promise.all([
    provider.positions(
      progressedJd,
      BODIES.map((body) => body.id),
      positionOptions,
    ),
    provider.houses(progressedJd, place, houseSystem, options.zodiac),
  ]);

  return { method, natalJd, progressedJd, ageInYears: ageInYears(natalJd, targetJd), positions, houses };
}
