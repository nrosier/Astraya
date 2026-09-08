/**
 * Solar and lunar returns (#49): the moment a body returns to its exact
 * natal ecliptic longitude, found via Swiss Ephemeris's own crossing
 * root-finders (`EphemerisProvider.nextSunCrossing`/`nextMoonCrossing`)
 * rather than a hand-rolled search — they are exact and already available.
 */
import type { Degrees, EphemerisProvider, JulianDayUT, Zodiac } from '../ephemeris/types.js';

/**
 * The solar return within a given calendar year: the Sun returns to its
 * exact natal longitude once a year, so starting the crossing search at
 * that year's Jan 1 00:00 UT and taking the very next crossing always lands
 * on that year's return, wherever in the year the birthday falls — including
 * Dec 31, since the next return after Jan 1 is still within the same year.
 */
export async function solarReturnInYear(
  provider: EphemerisProvider,
  natalSunLongitude: Degrees,
  year: number,
  zodiac?: Zodiac,
): Promise<JulianDayUT> {
  const searchStart = await provider.julianDay(year, 1, 1, 0);
  return provider.nextSunCrossing(searchStart, natalSunLongitude, zodiac);
}

/**
 * Forward offset used to move past an already-found crossing before
 * searching for the next one in `lunarReturnsInPeriod`. Small relative to
 * the ~27.3-day gap between real lunar returns, so it cannot skip one.
 */
const SEARCH_EPSILON_DAYS = 0.01;

/** Every lunar return within `[periodStartJd, periodEndJd]`, in order. */
export async function lunarReturnsInPeriod(
  provider: EphemerisProvider,
  natalMoonLongitude: Degrees,
  periodStartJd: JulianDayUT,
  periodEndJd: JulianDayUT,
  zodiac?: Zodiac,
): Promise<readonly JulianDayUT[]> {
  const returns: JulianDayUT[] = [];
  let searchFrom = periodStartJd;
  while (searchFrom <= periodEndJd) {
    const next = await provider.nextMoonCrossing(searchFrom, natalMoonLongitude, zodiac);
    if (next > periodEndJd) break;
    returns.push(next);
    searchFrom = next + SEARCH_EPSILON_DAYS;
  }
  return returns;
}
