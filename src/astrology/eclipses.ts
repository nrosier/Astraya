/**
 * Eclipses in a span of time, placed in the zodiac, and their contacts to a natal chart (#404).
 *
 * The eclipse search itself is Swiss Ephemeris' own (`EphemerisProvider.nextSolarEclipse` /
 * `nextLunarEclipse`) — exact umbral and penumbral geometry, not an approximation from node
 * proximity. What this module adds is the astrologer's view of each one: *where* it falls.
 *
 * An eclipse's degree is that of the luminary being eclipsed at greatest eclipse: the Sun (which
 * the New Moon is in conjunction with) for a solar eclipse, the Moon for a lunar one. A lunar
 * eclipse also lights its opposite point, the Sun's degree, so a natal point on either end of that
 * axis is touched; a solar eclipse is read at its own degree and its opposite the same way.
 *
 * **Natal contacts** are the practical reason anyone consults a list of eclipses: an eclipse close
 * to a natal point is the traditionally significant one. The convention, stated rather than picked
 * silently: a natal point is *touched* when the eclipse degree, or the degree opposite it, lies
 * within `DEFAULT_CONTACT_ORB_DEG` (3°) of it — a conjunction or an opposition. Squares and other
 * aspects are not counted; orbs for eclipses are conventionally tight because the effect is read
 * from the eclipse's single degree, not from a moving body's approach.
 */
import { bodyByKey } from './bodies.js';
import type {
  Degrees,
  EphemerisProvider,
  JulianDayUT,
  LunarEclipseKind,
  PositionOptions,
  SolarEclipseKind,
  Zodiac,
} from '../ephemeris/types.js';

/** Within this many degrees of a natal point counts as touching it. */
export const DEFAULT_CONTACT_ORB_DEG = 3;

/** The two eclipses of a given kind can never be closer than this, so the search resumes this far on. */
const MIN_ECLIPSE_GAP_DAYS = 20;

export type EclipseFamily = 'solar' | 'lunar';

export interface Eclipse {
  readonly family: EclipseFamily;
  readonly kind: SolarEclipseKind | LunarEclipseKind;
  /** Greatest eclipse. */
  readonly maxJd: JulianDayUT;
  readonly startJd: JulianDayUT;
  readonly endJd: JulianDayUT;
  /** The eclipsed luminary's ecliptic longitude at greatest eclipse. */
  readonly longitude: Degrees;
}

export interface EclipseSearchOptions {
  readonly zodiac?: Zodiac;
}

/**
 * Every solar and lunar eclipse with greatest eclipse in `[fromJd, toJd]`, in chronological order.
 */
export async function findEclipses(
  provider: EphemerisProvider,
  fromJd: JulianDayUT,
  toJd: JulianDayUT,
  options: EclipseSearchOptions = {},
): Promise<readonly Eclipse[]> {
  if (toJd < fromJd) throw new RangeError('toJd must not be before fromJd');
  const sun = bodyByKey('sun');
  const moon = bodyByKey('moon');
  if (sun === undefined || moon === undefined) throw new Error('unreachable: the Sun and Moon are always in BODIES');
  const positionOptions: PositionOptions | undefined =
    options.zodiac === undefined ? undefined : { zodiac: options.zodiac };

  const eclipses: Eclipse[] = [];

  let cursor = fromJd;
  for (;;) {
    const eclipse = await provider.nextSolarEclipse(cursor);
    if (eclipse.maxJd > toJd) break;
    const position = await provider.position(eclipse.maxJd, sun.id, positionOptions);
    eclipses.push({
      family: 'solar',
      kind: eclipse.kind,
      maxJd: eclipse.maxJd,
      startJd: eclipse.startJd,
      endJd: eclipse.endJd,
      longitude: position.longitude,
    });
    cursor = eclipse.maxJd + MIN_ECLIPSE_GAP_DAYS;
  }

  cursor = fromJd;
  for (;;) {
    const eclipse = await provider.nextLunarEclipse(cursor);
    if (eclipse.maxJd > toJd) break;
    const position = await provider.position(eclipse.maxJd, moon.id, positionOptions);
    eclipses.push({
      family: 'lunar',
      kind: eclipse.kind,
      maxJd: eclipse.maxJd,
      startJd: eclipse.penumbralStartJd,
      endJd: eclipse.penumbralEndJd,
      longitude: position.longitude,
    });
    cursor = eclipse.maxJd + MIN_ECLIPSE_GAP_DAYS;
  }

  return eclipses.sort((a, b) => a.maxJd - b.maxJd);
}

export interface NatalPoint {
  /** A `BodyDefinition.key`, or `'asc'` / `'mc'`. */
  readonly key: string;
  readonly longitude: Degrees;
}

export interface EclipseContact {
  readonly pointKey: string;
  /** Which end of the eclipse axis the point is on: the eclipse degree itself, or the one opposite. */
  readonly kind: 'conjunction' | 'opposition';
  /** Distance from that end, in degrees. */
  readonly orb: Degrees;
}

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

function separation(a: Degrees, b: Degrees): Degrees {
  const diff = norm360(a - b);
  return diff > 180 ? 360 - diff : diff;
}

/**
 * The natal points an eclipse touches: those within `orb` degrees of its degree (a conjunction) or
 * of the degree opposite it (an opposition), closest first.
 */
export function eclipseContacts(
  eclipse: Eclipse,
  points: readonly NatalPoint[],
  orb: Degrees = DEFAULT_CONTACT_ORB_DEG,
): readonly EclipseContact[] {
  const contacts: EclipseContact[] = [];
  for (const point of points) {
    const conjunction = separation(point.longitude, eclipse.longitude);
    const opposition = separation(point.longitude, eclipse.longitude + 180);
    if (conjunction <= orb) contacts.push({ pointKey: point.key, kind: 'conjunction', orb: conjunction });
    else if (opposition <= orb) contacts.push({ pointKey: point.key, kind: 'opposition', orb: opposition });
  }
  return contacts.sort((a, b) => a.orb - b.orb);
}
