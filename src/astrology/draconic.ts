/**
 * The draconic chart (#398): every body's longitude re-measured from the natal North Node rather
 * than from zero Aries. Houses are not transformed — there is no second "draconic Ascendant" in
 * standard practice; the natal houses stay, and only body positions move onto the draconic
 * zodiac. That makes this strictly simpler than the harmonic/Varga transform in
 * `harmonics.ts`, which does need its own house transform.
 */
import type { BodyPosition, Degrees } from '../ephemeris/types.js';

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** `natalLongitude - nodeLongitude`, wrapped back into 0-360. */
export function draconicLongitude(natalLongitude: Degrees, nodeLongitude: Degrees): Degrees {
  return norm360(natalLongitude - nodeLongitude);
}

/**
 * A body's draconic position. Only longitude is transformed — latitude, distance, every speed and
 * `retrograde` are carried over unchanged, for the same reason `harmonicPosition` leaves them
 * alone: this relabels where a body sits on the zodiac, it does not change how it is moving.
 */
export function draconicPosition(natal: BodyPosition, nodeLongitude: Degrees): BodyPosition {
  return { ...natal, longitude: draconicLongitude(natal.longitude, nodeLongitude) };
}
