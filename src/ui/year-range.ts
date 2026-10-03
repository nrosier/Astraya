/**
 * The year range the shipped ephemeris data covers, and the clamp for a year typed into a
 * range field (shared by the planetary-cycles and eclipse screens).
 */

/** The shipped ephemeris data (`sepl_18` and friends) covers 1800 to 2400. */
export const MIN_EPHEMERIS_YEAR = 1800;
export const MAX_EPHEMERIS_YEAR = 2399;

/** Clamps a typed year into the range the ephemeris covers; `undefined` for anything that is not a whole number. */
export function clampEphemerisYear(value: string): number | undefined {
  if (!/^-?\d+$/.test(value.trim())) return undefined;
  return Math.min(MAX_EPHEMERIS_YEAR, Math.max(MIN_EPHEMERIS_YEAR, Number(value)));
}
