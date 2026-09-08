/**
 * Declination overlay: chords across the wheel for parallel/contraparallel
 * contacts (#32, #148).
 *
 * Unlike antiscia (`antiscia-overlay.ts`), `declinationContacts` (#32) already
 * returns each body pair exactly once — it only ever iterates `i < j` — so
 * there is no mirrored duplicate to dedupe here, just the toggle/orb-tightness
 * display filters, then one `<line>` per contact, the same idiom as
 * `aspect-web.ts` (#42) and `antiscia-overlay.ts`. A contact is drawn between
 * the two bodies' *ecliptic longitudes* on the wheel (declination itself has
 * no place on a longitude-based wheel), so the chord marks which two bodies
 * are in contact, not where the contact "is".
 */
import type { DeclinationContact, DeclinationContactKind } from '../astrology/declinations.js';
import type { BodyId, Degrees } from '../ephemeris/types.js';
import type { WheelOrientationOptions } from './wheel.js';
import { pointOnCircle, wheelAngle } from './wheel.js';

export interface DeclinationDisplayFilter {
  /** Only these contact kinds are shown; omit to show both parallel and contraparallel. */
  readonly visibleKinds?: readonly DeclinationContactKind[];
  /** Drop any contact whose orb is wider than this, in degrees. */
  readonly maxOrb?: Degrees;
}

/** Applies the kind and orb-tightness display toggles to a computed declination-contact list. */
export function filterDeclinationContactsForDisplay(
  contacts: readonly DeclinationContact[],
  filter: DeclinationDisplayFilter = {},
): readonly DeclinationContact[] {
  const kinds = filter.visibleKinds ? new Set(filter.visibleKinds) : undefined;
  return contacts.filter((contact) => {
    if (kinds && !kinds.has(contact.kind)) return false;
    if (filter.maxOrb !== undefined && contact.orb > filter.maxOrb) return false;
    return true;
  });
}

function fmt(value: number): string {
  return value.toFixed(2);
}

const KIND_CLASS: Record<DeclinationContactKind, string> = {
  parallel: 'parallel',
  contraparallel: 'contraparallel',
};

/**
 * Renders one `<line>` per declination contact, chording the circle of radius
 * `radius` centered at `(cx, cy)`, at each body's ecliptic longitude.
 * `longitudeOf` resolves each contact's two bodies to true ecliptic
 * longitude; `cx`/`cy`/`ascendant`/`orientationOptions` must match the
 * `renderWheelSvg` call this is layered onto (#39, #43).
 */
export function renderDeclinationOverlaySvg(
  contacts: readonly DeclinationContact[],
  longitudeOf: (body: BodyId) => Degrees,
  ascendant: Degrees,
  cx: number,
  cy: number,
  radius: number,
  orientationOptions?: WheelOrientationOptions,
): string {
  const parts: string[] = [];
  for (const contact of contacts) {
    const angleA = wheelAngle(longitudeOf(contact.a), ascendant, orientationOptions);
    const angleB = wheelAngle(longitudeOf(contact.b), ascendant, orientationOptions);
    const pointA = pointOnCircle(cx, cy, radius, angleA);
    const pointB = pointOnCircle(cx, cy, radius, angleB);
    const className = `chart-declination chart-declination-${KIND_CLASS[contact.kind]}`;
    parts.push(
      `<line x1="${fmt(pointA.x)}" y1="${fmt(pointA.y)}" x2="${fmt(pointB.x)}" y2="${fmt(pointB.y)}" class="${className}" />`,
    );
  }
  return parts.join('');
}
