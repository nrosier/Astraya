/**
 * Tertiary and minor progressions (#48): two more day-for-X substitutions
 * built on the same idea as secondary progression, just with a different
 * life unit standing in for "one day of ephemeris motion" — see
 * `progressions.ts`'s doc comment for the secondary case this contrasts with.
 *
 * - Tertiary progresses one day for every lunar month of life: the offset
 *   added to the natal Julian day is the number of synodic months elapsed
 *   since birth (`ageInSynodicMonths`).
 * - Minor progresses one lunar month for every year of life: the offset
 *   added to the natal Julian day is the number of years elapsed since
 *   birth (secondary's own `ageInYears`), converted into lunar months.
 *
 * Both recompute bodies and houses directly at the progressed moment —
 * exactly what secondary progression's `'quotidian'` MC method does — since
 * neither technique has competing schools for how the angles should move
 * the way secondary's naibod/solarArc/quotidian split does.
 */
import { ageInYears } from './progressions.js';
import type { JulianDayUT } from '../ephemeris/types.js';

/** Average synodic (new-moon-to-new-moon) lunar month, in days. */
export const SYNODIC_MONTH_DAYS = 29.530588;

export type MinorProgressionMethod = 'tertiary' | 'minor';

/** Real time elapsed since birth, expressed in synodic months rather than years. */
export function ageInSynodicMonths(natalJd: JulianDayUT, targetJd: JulianDayUT): number {
  return (targetJd - natalJd) / SYNODIC_MONTH_DAYS;
}

/**
 * The Julian day to compute bodies and houses at for a tertiary or minor
 * progression. Distinct formulas, not a shared one parameterized by a single
 * ratio: tertiary substitutes lunar months for secondary's years directly
 * (the offset itself is the age in lunar months), while minor keeps
 * secondary's own year-based age and re-expresses it in lunar months.
 */
export function minorProgressedJulianDay(
  method: MinorProgressionMethod,
  natalJd: JulianDayUT,
  targetJd: JulianDayUT,
): JulianDayUT {
  return method === 'tertiary'
    ? natalJd + ageInSynodicMonths(natalJd, targetJd)
    : natalJd + ageInYears(natalJd, targetJd) * SYNODIC_MONTH_DAYS;
}
