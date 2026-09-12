/**
 * Computes the next return of any body to its natal longitude, searching
 * forward from a chosen date (#50). Unlike a solar return, which is scoped
 * to a calendar year, other bodies' return periods range from under a month
 * (Moon) to decades (outer planets), so the caller supplies the search start
 * directly rather than a year.
 */
import { findCrossAspects, fixedSubjects, subjectsFrom, type Aspect, type OrbConfig } from '../astrology/aspects.js';
import { BODIES, bodyById, type BodyCategory } from '../astrology/bodies.js';
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

function categoryOf(body: BodyId): BodyCategory {
  const definition = bodyById(body);
  if (definition === undefined) throw new Error(`unreachable: ${String(body)} is always one of BODIES`);
  return definition.category;
}

export interface PlanetaryReturnOptions {
  readonly place?: GeoPosition;
  readonly houseSystem?: HouseSystem;
  readonly zodiac?: Zodiac;
  /**
   * Overrides the generic crossing search's step size (days) and iteration
   * budget for bodies without a dedicated exact root-finder — i.e. every
   * body except the Sun and Moon (#71). Built-in defaults already reach a
   * genuine Uranus, Neptune or Pluto return; supply these only to search
   * further still, or to narrow the search when the target is known nearby.
   */
  readonly stepDays?: number;
  readonly maxSteps?: number;
}

export interface PlanetaryReturnData {
  readonly body: BodyId;
  readonly natalJd: JulianDayUT;
  readonly returnJd: JulianDayUT;
  readonly place: GeoPosition;
  readonly positions: readonly BodyPosition[];
  readonly houses: HousePositions;
  /** Aspects between the return positions and the fixed natal chart. */
  readonly contacts: readonly Aspect[];
}

export async function computePlanetaryReturn(
  natalMoment: BirthMomentInput,
  body: BodyId,
  searchFromJd: JulianDayUT,
  provider: EphemerisProvider,
  options: PlanetaryReturnOptions = {},
  orbConfig?: OrbConfig,
): Promise<PlanetaryReturnData> {
  const resolved = resolveMoment(natalMoment);
  const natalJd = await julianDayFor(provider, resolved);
  const positionOptions = options.zodiac === undefined ? undefined : { zodiac: options.zodiac };

  const natalPositions = await provider.positions(
    natalJd,
    BODIES.map((b) => b.id),
    positionOptions,
  );
  const natalPosition = natalPositions.find((position) => position.body === body);
  if (natalPosition === undefined) {
    throw new Error(`unreachable: the ephemeris returned no position for body ${body}`);
  }

  const returnJd = await nextReturnOfBody(provider, body, natalPosition.longitude, searchFromJd, {
    ...(options.zodiac !== undefined ? { zodiac: options.zodiac } : {}),
    ...(options.stepDays !== undefined ? { stepDays: options.stepDays } : {}),
    ...(options.maxSteps !== undefined ? { maxSteps: options.maxSteps } : {}),
  });
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

  const contacts = findCrossAspects(
    subjectsFrom(positions, categoryOf),
    fixedSubjects(natalPositions, categoryOf),
    orbConfig,
  );

  return { body, natalJd, returnJd, place, positions, houses, contacts };
}
