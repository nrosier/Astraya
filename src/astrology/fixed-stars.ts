/**
 * Fixed star conjunctions and parans (#33).
 *
 * Conjunctions are the ordinary ecliptic-longitude kind: a star and a body
 * within orb of each other, exactly like `antiscialContacts` but against a
 * star's longitude instead of a reflected point.
 *
 * Parans are a mundane (mundo) contact rather than an ecliptic one: two
 * points "paran" when they cross the same pair of angles — rising,
 * culminating, setting, anti-culminating — at (near enough) the same
 * sidereal time, regardless of how far apart they are in ecliptic longitude.
 * Working this out needs each point's right ascension and declination (not
 * its ecliptic longitude/latitude) plus the observer's geographic latitude
 * (not longitude — that only shifts clock time, not which sidereal moment
 * two points share).
 *
 * The angle-crossing time is derived from the standard horizon equation
 * `sin(alt) = sin(lat)*sin(dec) + cos(lat)*cos(dec)*cos(H)` at `alt = 0`,
 * giving the semi-diurnal arc `H0 = arccos(-tan(lat)*tan(dec))` and, since
 * local hour angle is `armc - rightAscension`:
 *
 *   culminating:      armc = ra
 *   anticulminating:   armc = ra + 180
 *   rising:            armc = ra - H0
 *   setting:           armc = ra + H0
 *
 * `H0` is undefined (point circumpolar or never rising) when
 * `|tan(lat)*tan(dec)| > 1`, in which case rising/setting are `undefined`.
 */
import type { BodyId, Degrees } from '../ephemeris/types.js';
import { angularSeparation } from './aspects.js';

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

export interface FixedStarConjunction {
  readonly star: string;
  readonly body: BodyId;
  readonly orb: Degrees;
}

/** Every star/body pair within `orb` of each other in ecliptic longitude. */
export function fixedStarConjunctions(
  stars: ReadonlyMap<string, Degrees>,
  positions: ReadonlyMap<BodyId, Degrees>,
  orb: Degrees,
): readonly FixedStarConjunction[] {
  const contacts: FixedStarConjunction[] = [];
  for (const [star, starLongitude] of stars) {
    for (const [body, longitude] of positions) {
      const separation = angularSeparation(starLongitude, longitude);
      if (separation <= orb) contacts.push({ star, body, orb: separation });
    }
  }
  return contacts;
}

export type AngleEvent = 'rising' | 'culminating' | 'setting' | 'anticulminating';

/** A point's equatorial coordinates — what the paran calculation needs, as opposed to ecliptic longitude/latitude. */
export interface EquatorialPoint {
  readonly rightAscension: Degrees;
  readonly declination: Degrees;
}

/**
 * The sidereal time (ARMC, in degrees) at which a point reaches the given
 * angle, at geographic `latitude`. `undefined` for `rising`/`setting` when
 * the point is circumpolar or never rises at that latitude.
 * `culminating`/`anticulminating` are always defined.
 */
export function armcAtAngle(point: EquatorialPoint, latitude: Degrees, angle: AngleEvent): Degrees | undefined {
  if (angle === 'culminating') return norm360(point.rightAscension);
  if (angle === 'anticulminating') return norm360(point.rightAscension + 180);

  const cosSemiArc = -Math.tan((latitude * Math.PI) / 180) * Math.tan((point.declination * Math.PI) / 180);
  if (cosSemiArc < -1 || cosSemiArc > 1) return undefined;
  const semiArc = (Math.acos(cosSemiArc) * 180) / Math.PI;
  return norm360(point.rightAscension + (angle === 'rising' ? -semiArc : semiArc));
}

export interface Paran {
  readonly angleA: AngleEvent;
  readonly angleB: AngleEvent;
  /** Difference between the two points' ARMC at their respective angles, in degrees of sidereal time. */
  readonly orb: Degrees;
}

const ANGLE_EVENTS: readonly AngleEvent[] = ['rising', 'culminating', 'setting', 'anticulminating'];

/**
 * Every pair of angle events at which `a` and `b` paran within `orb` (degrees
 * of sidereal time — 1 degree is 4 minutes of time) at geographic `latitude`.
 */
export function parans(a: EquatorialPoint, b: EquatorialPoint, latitude: Degrees, orb: Degrees): readonly Paran[] {
  const results: Paran[] = [];
  for (const angleA of ANGLE_EVENTS) {
    const armcA = armcAtAngle(a, latitude, angleA);
    if (armcA === undefined) continue;
    for (const angleB of ANGLE_EVENTS) {
      const armcB = armcAtAngle(b, latitude, angleB);
      if (armcB === undefined) continue;
      const separation = angularSeparation(armcA, armcB);
      if (separation <= orb) results.push({ angleA, angleB, orb: separation });
    }
  }
  return results;
}
