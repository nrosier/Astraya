/**
 * Antiscia, contra-antiscia, and contacts to other bodies (#31).
 *
 * Antiscia mirror a longitude across the solstitial axis (0 Cancer/0 Capricorn,
 * i.e. 90/270): two points equally far from a solstice — one approaching it, one
 * receding — share the same declination and were treated by classical astrology
 * as a hidden conjunction. Reflecting across an axis through angle theta (mod 180)
 * is `2*theta - x`; with theta = 90, that's `180 - longitude`.
 *
 * Contra-antiscia mirror across the equinoctial axis (0 Aries/0 Libra, i.e. 0/180)
 * instead — equivalently, the point directly opposite the antiscion. Reflecting
 * across theta = 0 is `-longitude`.
 */
import type { BodyId, Degrees } from '../ephemeris/types.js';
import { angularSeparation } from './aspects.js';

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** The antiscion: `longitude` reflected across the solstitial (Cancer/Capricorn) axis. */
export function antiscionOf(longitude: Degrees): Degrees {
  return norm360(180 - longitude);
}

/** The contra-antiscion: `longitude` reflected across the equinoctial (Aries/Libra) axis. */
export function contraAntiscionOf(longitude: Degrees): Degrees {
  return norm360(-longitude);
}

export type AntiscialPointKind = 'antiscion' | 'contraAntiscion';

export interface AntiscialContact {
  /** The body whose antiscion or contra-antiscion this is. */
  readonly body: BodyId;
  readonly kind: AntiscialPointKind;
  /** The other body found at that reflected point, within orb. */
  readonly contact: BodyId;
  readonly orb: Degrees;
}

/**
 * Every other body that falls within `orb` of some body's antiscion or
 * contra-antiscion — a body reflected onto another is treated as a contact,
 * the same way a conjunction is.
 */
export function antiscialContacts(positions: ReadonlyMap<BodyId, Degrees>, orb: Degrees): readonly AntiscialContact[] {
  const contacts: AntiscialContact[] = [];
  for (const [body, longitude] of positions) {
    const points: readonly [AntiscialPointKind, Degrees][] = [
      ['antiscion', antiscionOf(longitude)],
      ['contraAntiscion', contraAntiscionOf(longitude)],
    ];
    for (const [kind, point] of points) {
      for (const [contact, contactLongitude] of positions) {
        if (contact === body) continue;
        const separation = angularSeparation(point, contactLongitude);
        if (separation <= orb) contacts.push({ body, kind, contact, orb: separation });
      }
    }
  }
  return contacts;
}
