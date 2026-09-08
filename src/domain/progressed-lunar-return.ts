/**
 * Computes the progressed lunar return chart for a target date (#50): the
 * most recent moment the real (transiting) Moon crossed the position of the
 * secondary-progressed Moon as of that date. Marks the start of the current
 * "progressed lunar month" — a finer-grained cycle than the year-scale
 * secondary progression itself, used the way a solar return chart is used
 * but roughly monthly instead of yearly.
 */
import { BODIES } from '../astrology/bodies.js';
import { progressedMoonLongitude, progressedLunarReturnOnOrBefore } from '../astrology/planetary-returns.js';
import { julianDayFor } from '../time/julian.js';
import { resolveMoment } from '../time/resolve.js';
import type {
  BodyPosition,
  Degrees,
  EphemerisProvider,
  GeoPosition,
  HousePositions,
  HouseSystem,
  JulianDayUT,
  Zodiac,
} from '../ephemeris/types.js';
import type { BirthMomentInput } from '../time/types.js';

const DEFAULT_HOUSE_SYSTEM: HouseSystem = 'P';

export interface ProgressedLunarReturnOptions {
  readonly place?: GeoPosition;
  readonly houseSystem?: HouseSystem;
  readonly zodiac?: Zodiac;
}

export interface ProgressedLunarReturnData {
  readonly natalJd: JulianDayUT;
  readonly targetJd: JulianDayUT;
  readonly progressedMoonLongitude: Degrees;
  readonly returnJd: JulianDayUT;
  readonly place: GeoPosition;
  readonly positions: readonly BodyPosition[];
  readonly houses: HousePositions;
}

export async function computeProgressedLunarReturn(
  natalMoment: BirthMomentInput,
  targetJd: JulianDayUT,
  provider: EphemerisProvider,
  options: ProgressedLunarReturnOptions = {},
): Promise<ProgressedLunarReturnData> {
  const resolved = resolveMoment(natalMoment);
  const natalJd = await julianDayFor(provider, resolved);
  const positionOptions = options.zodiac === undefined ? undefined : { zodiac: options.zodiac };

  const progressedLongitude = await progressedMoonLongitude(provider, natalJd, targetJd, options.zodiac);
  const returnJd = await progressedLunarReturnOnOrBefore(provider, progressedLongitude, targetJd, options.zodiac);
  const place: GeoPosition = options.place ?? { ...natalMoment.coordinates, altitude: 0 };
  const houseSystem = options.houseSystem ?? DEFAULT_HOUSE_SYSTEM;

  const [positions, houses] = await Promise.all([
    provider.positions(
      returnJd,
      BODIES.map((b) => b.id),
      positionOptions,
    ),
    provider.houses(returnJd, place, houseSystem, options.zodiac),
  ]);

  return { natalJd, targetJd, progressedMoonLongitude: progressedLongitude, returnJd, place, positions, houses };
}
