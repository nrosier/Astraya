/**
 * Computes every lunar return chart within a period (#49): the Moon returns
 * to its exact natal longitude roughly every 27.3 days, far more often than
 * the Sun, so this returns a list rather than a single chart. Each return is
 * cast at a chosen location (defaulting to the birthplace, overridable).
 */
import { BODIES } from '../astrology/bodies.js';
import { lunarReturnsInPeriod } from '../astrology/solar-lunar-returns.js';
import { SE } from '../ephemeris/generated-constants.js';
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

const DEFAULT_HOUSE_SYSTEM: HouseSystem = 'P';

export interface LunarReturnsOptions {
  readonly place?: GeoPosition;
  readonly houseSystem?: HouseSystem;
  readonly zodiac?: Zodiac;
}

export interface LunarReturnChart {
  readonly returnJd: JulianDayUT;
  readonly place: GeoPosition;
  readonly positions: readonly BodyPosition[];
  readonly houses: HousePositions;
}

export interface LunarReturnsData {
  readonly natalJd: JulianDayUT;
  readonly returns: readonly LunarReturnChart[];
}

export async function computeLunarReturns(
  natalMoment: BirthMomentInput,
  periodStartJd: JulianDayUT,
  periodEndJd: JulianDayUT,
  provider: EphemerisProvider,
  options: LunarReturnsOptions = {},
): Promise<LunarReturnsData> {
  const resolved = resolveMoment(natalMoment);
  const natalJd = await julianDayFor(provider, resolved);
  const positionOptions = options.zodiac === undefined ? undefined : { zodiac: options.zodiac };

  const [natalMoon] = await provider.positions(natalJd, [SE.SE_MOON], positionOptions);
  if (natalMoon === undefined) throw new Error('unreachable: the ephemeris returned no position for the Moon');
  const natalMoonLongitude = natalMoon.longitude;

  const returnJds = await lunarReturnsInPeriod(
    provider,
    natalMoonLongitude,
    periodStartJd,
    periodEndJd,
    options.zodiac,
  );
  const place: GeoPosition = options.place ?? { ...natalMoment.coordinates, altitude: 0 };
  const houseSystem = options.houseSystem ?? DEFAULT_HOUSE_SYSTEM;

  const returns = await Promise.all(
    returnJds.map(async (returnJd): Promise<LunarReturnChart> => {
      const [positions, houses] = await Promise.all([
        provider.positions(
          returnJd,
          BODIES.map((body) => body.id),
          positionOptions,
        ),
        provider.houses(returnJd, place, houseSystem, options.zodiac),
      ]);
      return { returnJd, place, positions, houses };
    }),
  );

  return { natalJd, returns };
}
