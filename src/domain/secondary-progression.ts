/**
 * Computes a secondary-progressed chart for a target date (#46).
 *
 * Mirrors `chart-compute.ts`'s shape deliberately: a natal Julian day, one
 * house call and one batch position call, just at two different moments
 * instead of one. Progressed body positions are ordinary ephemeris positions
 * at the progressed Julian day — the day-for-year substitution is the whole
 * trick, nothing about a body's own calculation changes. The angles are the
 * part that needs `progressions.ts`, because "the sky's rotation for one day"
 * is exactly what the three MC methods disagree about; see that module's doc
 * comment for the astrology.
 *
 * Takes a target Julian day rather than a target civil moment: there is no
 * chart-creation UI yet to attach a "progressed for this date" concept to
 * (see `chart.ts`'s own doc comment anticipating this), and a Julian day is
 * the natural unit here — a caller with a calendar date already has
 * `julianDayFor`/`provider.julianDay` to produce one.
 */
import { findCrossAspects, fixedSubjects, subjectsFrom, type Aspect, type OrbConfig } from '../astrology/aspects.js';
import { BODIES, bodyById, bodyByKey, type BodyCategory } from '../astrology/bodies.js';
import { computeProgressedHouses, type ProgressedMcMethod } from '../astrology/progressions.js';
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

function categoryOf(body: BodyId): BodyCategory {
  const definition = bodyById(body);
  if (definition === undefined) throw new Error(`unreachable: ${String(body)} is always one of BODIES`);
  return definition.category;
}

/** Placidus, matching `chart-compute.ts`'s default so the two are directly comparable. */
const DEFAULT_HOUSE_SYSTEM: HouseSystem = 'P';

/** Naibod, the most widely used of the three — the reasonable default absent a choice. */
const DEFAULT_MC_METHOD: ProgressedMcMethod = 'naibod';

export interface SecondaryProgressionOptions {
  readonly houseSystem?: HouseSystem;
  readonly mcMethod?: ProgressedMcMethod;
  readonly zodiac?: Zodiac;
}

export interface SecondaryProgressionData {
  readonly natalJd: JulianDayUT;
  readonly progressedJd: JulianDayUT;
  readonly ageInYears: number;
  readonly mcMethod: ProgressedMcMethod;
  readonly positions: readonly BodyPosition[];
  readonly houses: HousePositions;
  /** Aspects between the progressed positions and the fixed natal chart. */
  readonly contacts: readonly Aspect[];
}

/**
 * `provider` must already be initialized. `targetJd` is the moment being
 * progressed *to* — for a birthday reading that's simply "today", but any
 * Julian day is valid, including one before birth (`ageInYears` comes back
 * negative, which is a real and sometimes useful question — a psychological
 * progression to birth, say — not an error).
 */
export async function computeSecondaryProgression(
  natalMoment: BirthMomentInput,
  targetJd: JulianDayUT,
  provider: EphemerisProvider,
  options: SecondaryProgressionOptions = {},
  orbConfig?: OrbConfig,
): Promise<SecondaryProgressionData> {
  const resolved = resolveMoment(natalMoment);
  const natalJd = await julianDayFor(provider, resolved);
  const place: GeoPosition = { ...natalMoment.coordinates, altitude: 0 };
  const houseSystem = options.houseSystem ?? DEFAULT_HOUSE_SYSTEM;
  const mcMethod = options.mcMethod ?? DEFAULT_MC_METHOD;
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

  const progressed = await computeProgressedHouses(
    provider,
    natalJd,
    targetJd,
    natalHouses,
    natalSun.longitude,
    place,
    {
      mcMethod,
      houseSystem,
    },
  );

  const positions = await provider.positions(
    progressed.progressedJd,
    BODIES.map((body) => body.id),
    positionOptions,
  );

  const contacts = findCrossAspects(
    subjectsFrom(positions, categoryOf),
    fixedSubjects(natalPositions, categoryOf),
    orbConfig,
  );

  return {
    natalJd,
    progressedJd: progressed.progressedJd,
    ageInYears: progressed.ageInYears,
    mcMethod: progressed.mcMethod,
    positions,
    houses: progressed.houses,
    contacts,
  };
}
