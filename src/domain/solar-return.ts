/**
 * Computes a solar return chart for a given calendar year (#49): the moment
 * the Sun returns to its exact natal longitude, cast at a chosen location
 * (defaulting to the birthplace, but overridable — the return itself is a
 * moment in time, not tied to any particular place).
 */
import { BODIES } from '../astrology/bodies.js';
import { solarReturnInYear } from '../astrology/solar-lunar-returns.js';
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

export interface SolarReturnOptions {
  readonly place?: GeoPosition;
  readonly houseSystem?: HouseSystem;
  readonly zodiac?: Zodiac;
}

export interface SolarReturnData {
  readonly natalJd: JulianDayUT;
  readonly returnJd: JulianDayUT;
  readonly year: number;
  readonly place: GeoPosition;
  readonly positions: readonly BodyPosition[];
  readonly houses: HousePositions;
}

export async function computeSolarReturn(
  natalMoment: BirthMomentInput,
  year: number,
  provider: EphemerisProvider,
  options: SolarReturnOptions = {},
): Promise<SolarReturnData> {
  const resolved = resolveMoment(natalMoment);
  const natalJd = await julianDayFor(provider, resolved);
  const positionOptions = options.zodiac === undefined ? undefined : { zodiac: options.zodiac };

  const [natalSun] = await provider.positions(natalJd, [SE.SE_SUN], positionOptions);
  if (natalSun === undefined) throw new Error('unreachable: the ephemeris returned no position for the Sun');
  const natalSunLongitude = natalSun.longitude;

  const returnJd = await solarReturnInYear(provider, natalSunLongitude, year, options.zodiac);
  const place: GeoPosition = options.place ?? { ...natalMoment.coordinates, altitude: 0 };
  const houseSystem = options.houseSystem ?? DEFAULT_HOUSE_SYSTEM;

  const [positions, houses] = await Promise.all([
    provider.positions(
      returnJd,
      BODIES.map((body) => body.id),
      positionOptions,
    ),
    provider.houses(returnJd, place, houseSystem, options.zodiac),
  ]);

  return { natalJd, returnJd, year, place, positions, houses };
}
