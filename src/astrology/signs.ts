/**
 * The 12 tropical zodiac signs, as a pure partition of ecliptic longitude.
 *
 * Like `nakshatras.ts`, this is definitional rather than computed by Swiss
 * Ephemeris: each sign spans exactly 30 degrees starting from 0 Aries, with no
 * dependency on live ephemeris data. Sidereal placements use the same
 * partition — it is the longitude itself (already ayanamsa-shifted by the
 * engine) that differs, not the sign boundaries.
 */
import type { Degrees } from '../ephemeris/types.js';

export type Element = 'fire' | 'earth' | 'air' | 'water';
export type Modality = 'cardinal' | 'fixed' | 'mutable';

export interface SignDefinition {
  /** 0..11, 0 = Aries. */
  readonly index: number;
  readonly name: string;
  readonly element: Element;
  readonly modality: Modality;
}

/** The width of one sign. */
export const SIGN_SPAN: Degrees = 30;

export const SIGNS: readonly SignDefinition[] = [
  { index: 0, name: 'Aries', element: 'fire', modality: 'cardinal' },
  { index: 1, name: 'Taurus', element: 'earth', modality: 'fixed' },
  { index: 2, name: 'Gemini', element: 'air', modality: 'mutable' },
  { index: 3, name: 'Cancer', element: 'water', modality: 'cardinal' },
  { index: 4, name: 'Leo', element: 'fire', modality: 'fixed' },
  { index: 5, name: 'Virgo', element: 'earth', modality: 'mutable' },
  { index: 6, name: 'Libra', element: 'air', modality: 'cardinal' },
  { index: 7, name: 'Scorpio', element: 'water', modality: 'fixed' },
  { index: 8, name: 'Sagittarius', element: 'fire', modality: 'mutable' },
  { index: 9, name: 'Capricorn', element: 'earth', modality: 'cardinal' },
  { index: 10, name: 'Aquarius', element: 'air', modality: 'fixed' },
  { index: 11, name: 'Pisces', element: 'water', modality: 'mutable' },
];

/** Normalise to the half-open interval [0, 360). */
function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** The zero-based sign index (0 = Aries) for a longitude, wrapping first. */
export function signIndex(longitude: Degrees): number {
  return Math.floor(norm360(longitude) / SIGN_SPAN);
}

/** The sign for a longitude, wrapping first. */
export function signOf(longitude: Degrees): SignDefinition {
  const index = signIndex(longitude);
  const sign = SIGNS[index];
  if (!sign) throw new Error(`unreachable: sign index ${index} out of range`);
  return sign;
}

/** Degrees elapsed within the sign, in [0, 30). */
export function degreesInSign(longitude: Degrees): Degrees {
  return norm360(longitude) - signIndex(longitude) * SIGN_SPAN;
}

/** The sign 180 degrees opposite, wrapping around the zodiac. */
export function oppositeSign(index: number): number {
  return (index + 6) % 12;
}
