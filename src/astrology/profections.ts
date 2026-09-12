/**
 * Annual and monthly profections (#168): a house-per-year rotation of the natal Ascendant,
 * one of the oldest Hellenistic timing techniques and distinct from progressions, solar arc
 * and returns (all M6) — none of those move the Ascendant by whole signs on a fixed schedule.
 *
 * Convention, documented here since sources disagree (the issue's own last checklist item):
 *
 * - Year zero (birth to the first birthday) profects the Ascendant's own sign — the technique
 *   starts counting from the angle itself, not one house past it. Each completed year of age
 *   advances the profection one further sign (mod 12), so ages 12, 24, 36... all land back on
 *   the natal Ascendant's sign, the standard 12-year Hellenistic cycle.
 * - The profected point keeps the Ascendant's own degree within its new sign (e.g. a natal
 *   Ascendant at 14°Leo profects to 14° of whichever sign the year lands on), rather than
 *   sitting at 0° of that sign — this is "whole sign" profection of the *angle*, not a
 *   coarser "which sign is activated" fact with no degree at all.
 * - Monthly profection subdivides the profected year into its own further 12 signs, advancing
 *   one sign per month starting from the year's own profected sign — so by the twelfth month
 *   the rotation has come back around to one sign before the *next* year's profection. Age is
 *   given as a single fractional-years number (`ageInYears` from `progressions.ts`, the same
 *   365.2425-day tropical year every other timing technique in this codebase already uses);
 *   the integer part selects the year, the fractional part split into twelfths selects the
 *   month within it.
 *
 * "Lord of the Year"/"Lord of the Month" is the ruler of the profected sign — callers resolve
 * that themselves via `rulerOf` (`dignities.ts`), since which rulership scheme to use is a
 * caller-level choice this module has no opinion on.
 */
import { degreesInSign, signIndex, SIGN_SPAN } from './signs.js';
import type { Degrees } from '../ephemeris/types.js';

/** Positive modulo, since a negative age (before birth) is a real and valid question here. */
function mod12(value: number): number {
  return ((value % 12) + 12) % 12;
}

/**
 * `age` typically arrives as `(targetJd - natalJd) / TROPICAL_YEAR_DAYS` — floating-point
 * cancellation in that division means an age that is mathematically exactly on a year or
 * month boundary (a target JD built as `natalJd + N * TROPICAL_YEAR_DAYS`, or a real user
 * asking "as of" the exact birthday instant) can come back as `N - 1e-15` rather than `N`.
 * `Math.floor` alone would then quietly land one sign short. Nudging by an epsilon far
 * larger than that float noise but far smaller than any real, intentionally-fractional age
 * fixes the boundary without changing any genuinely fractional case.
 */
const EPSILON = 1e-9;

function flooredYears(age: number): number {
  return Math.floor(age + EPSILON);
}

export interface ProfectedPoint {
  /** 0..11, 0 = Aries. */
  readonly signIndex: number;
  /** The profected point itself: the profected sign, at the Ascendant's own degree within it. */
  readonly longitude: Degrees;
}

/** The annual profection for a given age (fractional tropical years since birth; only the integer part matters). */
export function annualProfection(ascendantLongitude: Degrees, age: number): ProfectedPoint {
  const years = flooredYears(age);
  const index = mod12(signIndex(ascendantLongitude) + years);
  return { signIndex: index, longitude: index * SIGN_SPAN + degreesInSign(ascendantLongitude) };
}

export interface MonthlyProfectedPoint extends ProfectedPoint {
  /** 0..11, the month within the profected year (0 = the year's own profected sign). */
  readonly monthIndex: number;
}

/** The monthly profection for a given age, subdividing the annual profection above into twelfths. */
export function monthlyProfection(ascendantLongitude: Degrees, age: number): MonthlyProfectedPoint {
  const years = flooredYears(age);
  const monthIndex = Math.floor((age - years) * 12 + EPSILON);
  const index = mod12(signIndex(ascendantLongitude) + years + monthIndex);
  return { signIndex: index, longitude: index * SIGN_SPAN + degreesInSign(ascendantLongitude), monthIndex };
}
