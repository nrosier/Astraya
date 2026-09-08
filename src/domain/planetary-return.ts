/**
 * Computes the next return of any body to its natal longitude, searching
 * forward from a chosen date (#50). Unlike a solar return, which is scoped
 * to a calendar year, other bodies' return periods range from under a month
 * (Moon) to decades (outer planets), so the caller supplies the search start
 * directly rather than a year.
 */
import { BODIES } from '../astrology/bodies.js';
import { nextReturnOfBody } from '../astrology/planetary-returns.js';
import { julianDayFor } from '../time/julian.js';
import { resolveMoment } from '../time/resolve.js';
import type {
  BodyId,
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

export interface PlanetaryReturnOptions {
  readonly place?: GeoPosition;
  readonly houseSystem?: HouseSystem;
  readonly zodiac?: Zodiac;
}

export interface PlanetaryReturnData {
  readonly body: BodyId;
  readonly natalJd: JulianDayUT;
  readonly returnJd: JulianDayUT;
  readonly place: GeoPosition;
  readonly positions: readonly BodyPosition[];
  readonly houses: HousePositions;
}

export async function computePlanetaryReturn(
  natalMoment: BirthMomentInput,
  body: BodyId,
  searchFromJd: JulianDayUT,
  provider: EphemerisProvider,
  options: PlanetaryReturnOptions = {},
): Promise<PlanetaryReturnData> {
  const resolved = resolveMoment(natalMoment);
  const natalJd = await julianDayFor(provider, resolved);
  const positionOptions = options.zodiac === undefined ? undefined : { zodiac: options.zodiac };

  const [natalPosition] = await provider.positions(natalJd, [body], positionOptions);
  if (natalPosition === undefined) {
    throw new Error(`unreachable: the ephemeris returned no position for body ${body}`);
  }

  const returnJd = await nextReturnOfBody(provider, body, natalPosition.longitude, searchFromJd, options.zodiac);
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

  return { body, natalJd, returnJd, place, positions, houses };
}
