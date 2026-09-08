/**
 * Secondary progressions: day-for-year, with a selectable method for progressing
 * the MC and the houses that follow from it (#46).
 *
 * Bodies progress by direct day-for-year substitution: their positions are simply
 * the ordinary ephemeris positions at the progressed Julian day, no different from
 * a natal calculation at a later date. The angles are not that simple, because
 * "the sky's rotation for one day" is itself what the three schools of secondary
 * progression disagree about:
 *
 * - `'quotidian'` recomputes the houses outright at the progressed moment, using
 *   the natal clock time and place. Because the progressed Julian day is only a
 *   few days past the natal one (one day per year of age), the MC this produces
 *   moves by close to the mean solar rate — nearly, but not exactly, what
 *   `'naibod'` below gives by simple arithmetic. Where quotidian visibly departs
 *   from the two symbolic methods is everywhere else: the Ascendant and the other
 *   cusps are a non-linear function of the progressed sidereal time, latitude and
 *   obliquity, not a rigid rotation of the natal ones, so they drift apart from a
 *   naibod/solar-arc chart even while the MCs stay close.
 * - `'naibod'` instead rotates every natal angle and cusp by a symbolic arc: the
 *   mean Sun's daily motion (360 degrees divided by the tropical year, about
 *   59'08") times the number of years of age. A uniform rate, chosen for its
 *   simplicity, in use for over a century.
 * - `'solarArc'` rotates the same way, but by the *true* solar arc — the actual
 *   distance the real Sun travelled between the natal and progressed Julian days
 *   — rather than the Sun's mean rate.
 *
 * Naibod and solar arc rotate the whole natal house wheel rigidly: every cusp and
 * every named angle moves by the same arc the MC does. That rigid rotation is what
 * "houses derived from the progressed MC" means for a symbolic method; quotidian
 * has no such arc because it recomputes the houses directly instead.
 */
import type {
  Degrees,
  EphemerisProvider,
  GeoPosition,
  HousePositions,
  HouseSystem,
  JulianDayUT,
} from '../ephemeris/types.js';

export type ProgressedMcMethod = 'quotidian' | 'naibod' | 'solarArc';

/** The mean tropical year, in days — the standard day-for-year divisor. */
export const TROPICAL_YEAR_DAYS = 365.2425;

/** The mean Sun's daily motion, in degrees — Naibod's key. */
export const NAIBOD_DAILY_MOTION: Degrees = 360 / TROPICAL_YEAR_DAYS;

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** Age in tropical years between a natal and a target Julian day. Negative before birth. */
export function ageInYears(natalJd: JulianDayUT, targetJd: JulianDayUT): number {
  return (targetJd - natalJd) / TROPICAL_YEAR_DAYS;
}

/** The day-for-year progressed Julian day: one day of ephemeris motion per year of age. */
export function progressedJulianDay(natalJd: JulianDayUT, targetJd: JulianDayUT): JulianDayUT {
  return natalJd + ageInYears(natalJd, targetJd);
}

/**
 * The arc applied to every natal angle and cusp under a symbolic (non-quotidian)
 * method. Not normalised to [0, 360): the arc accumulates without bound over a
 * long life, and only the shifted angles it produces need wrapping.
 */
export function mcArc(
  method: 'naibod' | 'solarArc',
  age: number,
  natalSunLongitude: Degrees,
  progressedSunLongitude: Degrees,
): Degrees {
  return method === 'naibod' ? age * NAIBOD_DAILY_MOTION : progressedSunLongitude - natalSunLongitude;
}

/** Rigidly rotates every natal cusp and angle by `arc`, for the two symbolic methods. */
export function shiftHouses(natal: HousePositions, arc: Degrees): HousePositions {
  const shift = (deg: Degrees): Degrees => norm360(deg + arc);
  return {
    cusps: natal.cusps.map(shift),
    ascendant: shift(natal.ascendant),
    midheaven: shift(natal.midheaven),
    armc: norm360(natal.armc + arc),
    vertex: shift(natal.vertex),
    equatorialAscendant: shift(natal.equatorialAscendant),
    coAscendantKoch: shift(natal.coAscendantKoch),
    coAscendantMunkasey: shift(natal.coAscendantMunkasey),
    polarAscendant: shift(natal.polarAscendant),
    system: natal.system,
    ...(natal.warning === undefined ? {} : { warning: natal.warning }),
  };
}

export interface SecondaryProgressionOptions {
  readonly mcMethod: ProgressedMcMethod;
  readonly houseSystem: HouseSystem;
}

export interface ProgressedHouses {
  readonly progressedJd: JulianDayUT;
  readonly ageInYears: number;
  readonly mcMethod: ProgressedMcMethod;
  readonly houses: HousePositions;
}

/**
 * The progressed Julian day and the progressed houses for a natal chart, under
 * the given MC method. Progressed *body* positions are not this function's
 * job — they are ordinary `provider.positions` calls at the returned
 * `progressedJd`, exactly like a natal chart at a later date.
 */
export async function computeProgressedHouses(
  provider: EphemerisProvider,
  natalJd: JulianDayUT,
  targetJd: JulianDayUT,
  natalHouses: HousePositions,
  natalSunLongitude: Degrees,
  place: GeoPosition,
  options: SecondaryProgressionOptions,
): Promise<ProgressedHouses> {
  const progressedJd = progressedJulianDay(natalJd, targetJd);
  const age = ageInYears(natalJd, targetJd);

  if (options.mcMethod === 'quotidian') {
    const houses = await provider.houses(progressedJd, place, options.houseSystem);
    return { progressedJd, ageInYears: age, mcMethod: 'quotidian', houses };
  }

  const [progressedSun] = await provider.positions(progressedJd, [0]);
  if (progressedSun === undefined) throw new Error('unreachable: the ephemeris returned no position for the Sun');
  const arc = mcArc(options.mcMethod, age, natalSunLongitude, progressedSun.longitude);
  return { progressedJd, ageInYears: age, mcMethod: options.mcMethod, houses: shiftHouses(natalHouses, arc) };
}
