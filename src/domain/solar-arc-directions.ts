/**
 * Computes a solar arc directions chart for a target date (#47).
 *
 * Mirrors `secondary-progression.ts`'s shape: a natal Julian day, one house
 * and one batch position call at birth, then the same shared arc applied to
 * every body and every angle — the whole point of the technique, versus
 * secondary progression's `'solarArc'` MC method which only ever rotates the
 * angles. Contacts to the fixed natal chart are found the same way any two
 * charts would be compared (`findCrossAspects`), and each contact found in
 * orb is also given its exact date, resolved against the real ephemeris
 * since the true solar arc is not perfectly linear in time.
 */
import { findCrossAspects, type Aspect, type OrbConfig } from '../astrology/aspects.js';
import { BODIES, bodyByKey, bodyById, type BodyCategory } from '../astrology/bodies.js';
import { ageInYears, mcArc, progressedJulianDay, shiftHouses } from '../astrology/progressions.js';
import {
  arcsToExactness,
  directedSubjects,
  directPositions,
  findExactnessJd,
  fixedNatalSubjects,
  type DirectedPosition,
} from '../astrology/solar-arc-directions.js';
import { julianDayFor } from '../time/julian.js';
import { resolveMoment } from '../time/resolve.js';
import type {
  BodyId,
  Degrees,
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

export interface SolarArcDirectionsOptions {
  readonly houseSystem?: HouseSystem;
  readonly zodiac?: Zodiac;
}

export interface DirectedContact extends Aspect {
  /** The Julian day the contact becomes exact, or undefined if not within a 150-year search window. */
  readonly exactJd: JulianDayUT | undefined;
}

export interface SolarArcDirectionsData {
  readonly natalJd: JulianDayUT;
  readonly progressedJd: JulianDayUT;
  readonly ageInYears: number;
  readonly arc: Degrees;
  readonly directedPositions: readonly DirectedPosition[];
  readonly houses: HousePositions;
  readonly contacts: readonly DirectedContact[];
}

function categoryOf(body: BodyId): BodyCategory {
  const definition = bodyById(body);
  if (definition === undefined) throw new Error(`unreachable: ${String(body)} is always one of BODIES`);
  return definition.category;
}

/**
 * `provider` must already be initialized. `targetJd` is the moment being
 * directed *to* — see `computeSecondaryProgression`'s doc comment on the
 * same parameter for why a Julian day rather than a civil date.
 */
export async function computeSolarArcDirections(
  natalMoment: BirthMomentInput,
  targetJd: JulianDayUT,
  provider: EphemerisProvider,
  options: SolarArcDirectionsOptions = {},
  orbConfig?: OrbConfig,
): Promise<SolarArcDirectionsData> {
  const resolved = resolveMoment(natalMoment);
  const natalJd = await julianDayFor(provider, resolved);
  const place: GeoPosition = { ...natalMoment.coordinates, altitude: 0 };
  const houseSystem = options.houseSystem ?? DEFAULT_HOUSE_SYSTEM;
  const positionOptions = options.zodiac === undefined ? undefined : { zodiac: options.zodiac };

  const sun = bodyByKey('sun');
  if (sun === undefined) throw new Error('unreachable: sun is always in BODIES');

  const [natalHouses, natalPositions] = await Promise.all([
    provider.houses(natalJd, place, houseSystem, options.zodiac),
    provider.positions(
      natalJd,
      BODIES.map((body) => body.id),
      positionOptions,
    ),
  ]);
  const natalSun = natalPositions.find((position) => position.body === sun.id);
  if (natalSun === undefined) throw new Error('unreachable: the ephemeris returned no position for the Sun');

  const age = ageInYears(natalJd, targetJd);
  const progressedJd = progressedJulianDay(natalJd, targetJd);
  const [progressedSun] = await provider.positions(progressedJd, [sun.id]);
  if (progressedSun === undefined) throw new Error('unreachable: the ephemeris returned no position for the Sun');
  const arc = mcArc('solarArc', age, natalSun.longitude, progressedSun.longitude);

  const directed = directPositions(natalPositions, arc);
  const houses = shiftHouses(natalHouses, arc);

  const directedSide = directedSubjects(directed, categoryOf, progressedSun.longitudeSpeed);
  const natalSide = fixedNatalSubjects(natalPositions, categoryOf);
  const found = findCrossAspects(directedSide, natalSide, orbConfig);

  const natalLongitude = new Map<BodyId, Degrees>(
    natalPositions.map((position) => [position.body, position.longitude]),
  );
  const contacts = await Promise.all(
    found.map(async (contact): Promise<DirectedContact> => {
      const directedNatalLongitude = natalLongitude.get(contact.bodyA);
      const targetNatalLongitude = natalLongitude.get(contact.bodyB);
      if (directedNatalLongitude === undefined || targetNatalLongitude === undefined) {
        throw new Error('unreachable: every contact pairs bodies drawn from natalPositions');
      }
      const candidates = arcsToExactness(directedNatalLongitude, targetNatalLongitude, contact.aspect.angle);
      const requiredArc = candidates.reduce((closest, candidate) =>
        Math.abs(candidate - arc) < Math.abs(closest - arc) ? candidate : closest,
      );
      const exactJd = await findExactnessJd(provider, natalJd, natalSun.longitude, requiredArc);
      return { ...contact, exactJd };
    }),
  );

  return { natalJd, progressedJd, ageInYears: age, arc, directedPositions: directed, houses, contacts };
}
