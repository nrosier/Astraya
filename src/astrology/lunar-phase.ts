/**
 * The Moon's phase at a moment (#403): its elongation from the Sun, the modern eight-fold
 * name for it, and how much of the disk is lit.
 *
 * Convention, stated rather than picked silently: the eight phases are Dane Rudhyar's lunation
 * cycle, as Astro-Seek shows it, split into equal 45° slices of elongation counted from the
 * New Moon conjunction — New 0-45, Crescent 45-90, First Quarter 90-135, Gibbous 135-180, Full
 * 180-225, Disseminating 225-270, Last Quarter 270-315, Balsamic 315-360. A phase begins at its
 * lower bound, so an elongation of exactly 90° is the First Quarter and exactly 180° the Full Moon.
 * (Some traditions centre the New/Full/Quarter phases on their exact angle instead; this follows
 * the plain sliced-from-conjunction reading Astro-Seek prints.)
 *
 * Elongation is the Moon's longitude minus the Sun's, in [0, 360): increasing through the
 * waxing half and past 180° through the waning half, so it alone says waxing from waning, which
 * an unsigned angular separation could not. It is ecliptic longitude only, not the true
 * phase angle, which also depends on the Moon's latitude and distance — the difference is
 * under a degree, far below what a name or a rounded percentage can show.
 */
import type { Degrees } from '../ephemeris/types.js';

export type LunarPhaseKey =
  'new' | 'crescent' | 'first-quarter' | 'gibbous' | 'full' | 'disseminating' | 'last-quarter' | 'balsamic';

/** In order of increasing elongation, one per 45° slice. */
export const LUNAR_PHASES: readonly LunarPhaseKey[] = [
  'new',
  'crescent',
  'first-quarter',
  'gibbous',
  'full',
  'disseminating',
  'last-quarter',
  'balsamic',
];

const PHASE_WIDTH_DEG = 360 / LUNAR_PHASES.length;

export interface LunarPhase {
  /** Moon minus Sun, in [0, 360). */
  readonly elongation: Degrees;
  readonly phase: LunarPhaseKey;
  /** True from the New Moon to the Full Moon (elongation under 180°). */
  readonly waxing: boolean;
  /** Fraction of the disk lit, in [0, 1]. */
  readonly illumination: number;
}

/** Normalise to the half-open interval [0, 360). */
function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

export function lunarPhaseOf(moonLongitude: Degrees, sunLongitude: Degrees): LunarPhase {
  const elongation = norm360(moonLongitude - sunLongitude);
  const phase = LUNAR_PHASES[Math.floor(elongation / PHASE_WIDTH_DEG)];
  if (phase === undefined) throw new Error('unreachable: elongation is within [0, 360)');
  return {
    elongation,
    phase,
    waxing: elongation < 180,
    illumination: (1 - Math.cos((elongation * Math.PI) / 180)) / 2,
  };
}
