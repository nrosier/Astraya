/**
 * The 27 nakshatras (lunar mansions) and their padas, for any body's sidereal
 * longitude (#22).
 *
 * Purely arithmetic: each nakshatra spans exactly 360/27 = 13°20' of sidereal
 * longitude, divided into four padas of 3°20' each, with no dependency on
 * live ephemeris data — unlike a house cusp or an ayanamsa value, this
 * partition is definitional rather than computed by Swiss Ephemeris. The
 * 0-based indexing convention and exact span were nonetheless checked against
 * `swe_house_name`'s sibling `swe_split_deg(lon, SE_SPLIT_DEG_NAKSHATRA)`
 * empirically before writing this, rather than assumed.
 *
 * Nakshatra lords follow the classical Vimshottari dasha sequence — Ketu,
 * Venus, Sun, Moon, Mars, Rahu, Jupiter, Saturn, Mercury — repeated three
 * times across the 27 nakshatras. This is a fixed, universally documented
 * cycle, not something an ephemeris computes.
 *
 * Dashas and vargas are deliberately out of scope, per the issue.
 */
import type { Degrees } from '../ephemeris/types.js';

export type NakshatraLord = 'Ketu' | 'Venus' | 'Sun' | 'Moon' | 'Mars' | 'Rahu' | 'Jupiter' | 'Saturn' | 'Mercury';

export interface NakshatraDefinition {
  /** 0..26, matching swe_split_deg's own nakshatra numbering. */
  readonly index: number;
  readonly name: string;
  readonly lord: NakshatraLord;
}

const LORD_CYCLE: readonly NakshatraLord[] = [
  'Ketu',
  'Venus',
  'Sun',
  'Moon',
  'Mars',
  'Rahu',
  'Jupiter',
  'Saturn',
  'Mercury',
];

const NAMES: readonly string[] = [
  'Ashwini',
  'Bharani',
  'Krittika',
  'Rohini',
  'Mrigashira',
  'Ardra',
  'Punarvasu',
  'Pushya',
  'Ashlesha',
  'Magha',
  'Purva Phalguni',
  'Uttara Phalguni',
  'Hasta',
  'Chitra',
  'Swati',
  'Vishakha',
  'Anuradha',
  'Jyeshtha',
  'Mula',
  'Purva Ashadha',
  'Uttara Ashadha',
  'Shravana',
  'Dhanishta',
  'Shatabhisha',
  'Purva Bhadrapada',
  'Uttara Bhadrapada',
  'Revati',
];

export const NAKSHATRAS: readonly NakshatraDefinition[] = NAMES.map((name, index) => {
  const lord = LORD_CYCLE[index % LORD_CYCLE.length];
  if (lord === undefined) throw new Error(`unreachable: index ${index} out of cycle range`);
  return { index, name, lord };
});

/** 360/27 degrees: the width of one nakshatra. */
export const NAKSHATRA_SPAN: Degrees = 360 / 27;

/** One quarter of a nakshatra: 360/108 degrees. */
export const PADA_SPAN: Degrees = NAKSHATRA_SPAN / 4;

export interface NakshatraPosition {
  readonly nakshatra: NakshatraDefinition;
  /** 1..4. */
  readonly pada: number;
  /** Degrees elapsed within the nakshatra, in [0, NAKSHATRA_SPAN). */
  readonly degreesInNakshatra: Degrees;
}

/**
 * The nakshatra and pada for a sidereal longitude.
 *
 * `siderealLongitude` must already be normalised to [0, 360) — every
 * `BodyPosition.longitude` the engine returns already is, sidereal included,
 * so callers pass that value straight through.
 */
export function nakshatraPosition(siderealLongitude: Degrees): NakshatraPosition {
  const index = Math.floor(siderealLongitude / NAKSHATRA_SPAN);
  const nakshatra = NAKSHATRAS[index];
  if (!nakshatra) {
    throw new RangeError(`siderealLongitude ${siderealLongitude} is outside [0, 360)`);
  }
  const degreesInNakshatra = siderealLongitude - index * NAKSHATRA_SPAN;
  const pada = Math.floor(degreesInNakshatra / PADA_SPAN) + 1;
  return { nakshatra, pada, degreesInNakshatra };
}
