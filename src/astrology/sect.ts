/**
 * Sect (day/night), solar phase (oriental/occidental), and the Sun-proximity
 * conditions cazimi, combustion and under-the-beams (#28).
 *
 * Sect is easy to get backwards, so the reasoning is spelled out rather than
 * assumed: house cusps increase in the same direction as ecliptic longitude
 * as you go from house 1 (the Ascendant) around to house 12, for every house
 * system — that's why house 7 (the Descendant) always falls exactly 180
 * degrees from house 1, and house 10 (the Midheaven, literally overhead) is
 * always in the 7-12 half. So a longitude is above the horizon exactly when
 * it is 180-360 degrees past the Ascendant in the increasing-longitude
 * direction — no house cusps needed, just the Ascendant itself.
 *
 * Orientality follows the same increasing-longitude sweep, but for *time*
 * rather than *height*: the Ascendant sweeps through increasing longitude
 * once per day, so of two bodies, whichever one the Ascendant reaches first
 * rises first. A body behind the Sun (lower longitude, reached by the
 * Ascendant earlier that same rotation) therefore rises *before* the Sun —
 * traditionally called oriental, "of the sun" in the morning sky, and
 * astronomically to the Sun's west. A body ahead of the Sun rises after it:
 * occidental, an evening body, east of the Sun.
 */
import type { BodyPosition, Degrees } from '../ephemeris/types.js';
import { angularSeparation } from './aspects.js';

/** Normalise to the half-open interval [0, 360). */
function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

export type Sect = 'day' | 'night';

/** True when a longitude is in the above-horizon half of the ecliptic (houses 7-12). */
export function isAboveHorizon(longitude: Degrees, ascendant: Degrees): boolean {
  return norm360(longitude - ascendant) >= 180;
}

/** A chart's sect: day when the Sun is above the horizon, night otherwise. */
export function sectOf(sunLongitude: Degrees, ascendant: Degrees): Sect {
  return isAboveHorizon(sunLongitude, ascendant) ? 'day' : 'night';
}

export type SolarPhase = 'oriental' | 'occidental';

/**
 * Whether a body rises before the Sun (oriental) or after it (occidental).
 * `undefined` when the body is conjunct or exactly opposite the Sun, where
 * orientality isn't a meaningful distinction.
 */
export function solarPhaseOf(bodyLongitude: Degrees, sunLongitude: Degrees): SolarPhase | undefined {
  const diff = norm360(sunLongitude - bodyLongitude);
  if (diff === 0 || diff === 180) return undefined;
  return diff < 180 ? 'oriental' : 'occidental';
}

export type SolarCondition = 'cazimi' | 'combust' | 'underTheBeams' | 'free';

/** Within the Sun's own disk — roughly its apparent radius, 17 arcminutes. */
const CAZIMI_ORB: Degrees = 17 / 60;
/** Traditional combustion orb. */
const COMBUSTION_ORB: Degrees = 8;
/** Traditional under-the-beams orb, wider than and inclusive of combustion. */
const UNDER_THE_BEAMS_ORB: Degrees = 15;

/**
 * How close a body is to the Sun, classified into the traditional bands.
 * Not meaningful called with the Sun as `bodyLongitude` — it is always
 * exactly cazimi with itself, which is a degenerate case rather than a real
 * condition, and it is the caller's responsibility not to ask.
 */
export function solarConditionOf(bodyLongitude: Degrees, sunLongitude: Degrees): SolarCondition {
  const separation = angularSeparation(bodyLongitude, sunLongitude);
  if (separation <= CAZIMI_ORB) return 'cazimi';
  if (separation <= COMBUSTION_ORB) return 'combust';
  if (separation <= UNDER_THE_BEAMS_ORB) return 'underTheBeams';
  return 'free';
}

/** Convenience overload taking full positions rather than bare longitudes. */
export function solarConditionOfPosition(body: BodyPosition, sun: BodyPosition): SolarCondition {
  return solarConditionOf(body.longitude, sun.longitude);
}
