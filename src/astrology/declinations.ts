/**
 * Parallels, contraparallels, and out-of-bounds declination (#32).
 *
 * Declination is a body's north/south position off the celestial equator,
 * signed like the ecliptic latitude it replaces once positions are computed
 * with `equatorial: true` — unlike longitude, it does not wrap, so none of
 * this needs the `norm360` every other module in this directory has.
 *
 * A parallel is two bodies at (near enough) the same declination — the
 * equatorial analogue of a conjunction. A contraparallel is two bodies at the
 * same declination magnitude but opposite hemispheres — the analogue of an
 * opposition, since `decA + decB ~= 0` is exactly `decA ~= -decB`.
 *
 * "Out of bounds" is classical shorthand for a body whose declination
 * exceeds the Sun's own maximum — the obliquity of the ecliptic. The Sun,
 * bound to the ecliptic, can never itself go out of bounds; the Moon,
 * planets, and points with ecliptic latitude can.
 */
import type { BodyId, Degrees } from '../ephemeris/types.js';

/** Two bodies at (near enough) the same declination. */
export function isParallel(a: Degrees, b: Degrees, orb: Degrees): boolean {
  return Math.abs(a - b) <= orb;
}

/** Two bodies at the same declination magnitude, opposite hemispheres. */
export function isContraparallel(a: Degrees, b: Degrees, orb: Degrees): boolean {
  return Math.abs(a + b) <= orb;
}

/** Whether a declination is more extreme than the Sun ever gets. */
export function isOutOfBounds(declination: Degrees, obliquity: Degrees): boolean {
  return Math.abs(declination) > obliquity;
}

export type DeclinationContactKind = 'parallel' | 'contraparallel';

export interface DeclinationContact {
  readonly a: BodyId;
  readonly b: BodyId;
  readonly kind: DeclinationContactKind;
  readonly orb: Degrees;
}

/** Every unique body pair that is parallel or contraparallel within `orb`. */
export function declinationContacts(
  declinations: ReadonlyMap<BodyId, Degrees>,
  orb: Degrees,
): readonly DeclinationContact[] {
  const entries = Array.from(declinations.entries());
  const contacts: DeclinationContact[] = [];
  for (const [i, [a, declinationA]] of entries.entries()) {
    for (const [b, declinationB] of entries.slice(i + 1)) {
      const parallelOrb = Math.abs(declinationA - declinationB);
      if (parallelOrb <= orb) contacts.push({ a, b, kind: 'parallel', orb: parallelOrb });
      const contraparallelOrb = Math.abs(declinationA + declinationB);
      if (contraparallelOrb <= orb) contacts.push({ a, b, kind: 'contraparallel', orb: contraparallelOrb });
    }
  }
  return contacts;
}

export interface OutOfBoundsBody {
  readonly body: BodyId;
  readonly declination: Degrees;
}

/** Every body whose declination exceeds the given obliquity. */
export function outOfBoundsBodies(
  declinations: ReadonlyMap<BodyId, Degrees>,
  obliquity: Degrees,
): readonly OutOfBoundsBody[] {
  const result: OutOfBoundsBody[] = [];
  for (const [body, declination] of declinations) {
    if (isOutOfBounds(declination, obliquity)) result.push({ body, declination });
  }
  return result;
}
