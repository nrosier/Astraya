/**
 * Computes the demibirthday chart for a given calendar year (#50): the
 * moment the Sun reaches the point exactly opposite its natal longitude —
 * the real midpoint of the solar year, roughly (but not exactly, since the
 * Sun's speed varies) half a year after the birthday.
 */
import { BODIES } from '../astrology/bodies.js';
import { demibirthdayInYear } from '../astrology/planetary-returns.js';
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

export interface DemibirthdayOptions {
  readonly place?: GeoPosition;
  readonly houseSystem?: HouseSystem;
  readonly zodiac?: Zodiac;
}

export interface DemibirthdayData {
  readonly natalJd: JulianDayUT;
  readonly demibirthdayJd: JulianDayUT;
  readonly year: number;
  readonly place: GeoPosition;
  readonly positions: readonly BodyPosition[];
  readonly houses: HousePositions;
}

export async function computeDemibirthday(
  natalMoment: BirthMomentInput,
  year: number,
  provider: EphemerisProvider,
  options: DemibirthdayOptions = {},
): Promise<DemibirthdayData> {
  const resolved = resolveMoment(natalMoment);
  const natalJd = await julianDayFor(provider, resolved);
  const positionOptions = options.zodiac === undefined ? undefined : { zodiac: options.zodiac };

  const [natalSun] = await provider.positions(natalJd, [SE.SE_SUN], positionOptions);
  if (natalSun === undefined) throw new Error('unreachable: the ephemeris returned no position for the Sun');

  const demibirthdayJd = await demibirthdayInYear(provider, natalSun.longitude, year, options.zodiac);
  const place: GeoPosition = options.place ?? { ...natalMoment.coordinates, altitude: 0 };
  const houseSystem = options.houseSystem ?? DEFAULT_HOUSE_SYSTEM;

  const [positions, houses] = await Promise.all([
    provider.positions(
      demibirthdayJd,
      BODIES.map((b) => b.id),
      positionOptions,
    ),
    provider.houses(demibirthdayJd, place, houseSystem, options.zodiac),
  ]);

  return { natalJd, demibirthdayJd, year, place, positions, houses };
}
