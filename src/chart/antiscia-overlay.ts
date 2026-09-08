/**
 * Antiscia overlay: chords across the wheel for antiscial contacts (#31, #148).
 *
 * `antiscialContacts` (#31) reports each contact from both bodies' sides of
 * the mirror — since the reflection is symmetric, A's antiscion falling on B
 * always means B's antiscion falls on A, at the same orb — so a single chord
 * between the pair would otherwise be drawn twice. `filterAntisciaForDisplay`
 * applies the toggle/orb-tightness display filters and then dedupes by
 * unordered body pair + kind, mirroring `aspect-web.ts`'s (#42)
 * `filterAspectsForDisplay`; `renderAntisciaOverlaySvg` draws the same way,
 * one `<line>` per surviving contact.
 */
import type { AntiscialContact, AntiscialPointKind } from '../astrology/antiscia.js';
import type { BodyId, Degrees } from '../ephemeris/types.js';
import type { WheelOrientationOptions } from './wheel.js';
import { pointOnCircle, wheelAngle } from './wheel.js';

export interface AntisciaDisplayFilter {
  /** Only these contact kinds are shown; omit to show both antiscion and contra-antiscion. */
  readonly visibleKinds?: readonly AntiscialPointKind[];
  /** Drop any contact whose orb is wider than this, in degrees. */
  readonly maxOrb?: Degrees;
}

function dedupeKey(contact: AntiscialContact): string {
  const [x, y] = contact.body <= contact.contact ? [contact.body, contact.contact] : [contact.contact, contact.body];
  return `${contact.kind}:${String(x)}:${String(y)}`;
}

/** Applies the kind and orb-tightness display toggles, then dedupes mirrored contacts. */
export function filterAntisciaForDisplay(
  contacts: readonly AntiscialContact[],
  filter: AntisciaDisplayFilter = {},
): readonly AntiscialContact[] {
  const kinds = filter.visibleKinds ? new Set(filter.visibleKinds) : undefined;
  const seen = new Set<string>();
  const result: AntiscialContact[] = [];
  for (const contact of contacts) {
    if (kinds && !kinds.has(contact.kind)) continue;
    if (filter.maxOrb !== undefined && contact.orb > filter.maxOrb) continue;
    const key = dedupeKey(contact);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(contact);
  }
  return result;
}

function fmt(value: number): string {
  return value.toFixed(2);
}

const KIND_CLASS: Record<AntiscialPointKind, string> = {
  antiscion: 'antiscion',
  contraAntiscion: 'contra-antiscion',
};

/**
 * Renders one `<line>` per antiscial contact, chording the circle of radius
 * `radius` centered at `(cx, cy)` — the same idiom as `aspect-web.ts` (#42).
 * `longitudeOf` resolves each contact's two bodies to true ecliptic
 * longitude; `cx`/`cy`/`ascendant`/`orientationOptions` must match the
 * `renderWheelSvg` call this is layered onto (#39, #43). Callers should pass
 * contacts through `filterAntisciaForDisplay` first so mirrored duplicates
 * aren't drawn twice.
 */
export function renderAntisciaOverlaySvg(
  contacts: readonly AntiscialContact[],
  longitudeOf: (body: BodyId) => Degrees,
  ascendant: Degrees,
  cx: number,
  cy: number,
  radius: number,
  orientationOptions?: WheelOrientationOptions,
): string {
  const parts: string[] = [];
  for (const contact of contacts) {
    const angleA = wheelAngle(longitudeOf(contact.body), ascendant, orientationOptions);
    const angleB = wheelAngle(longitudeOf(contact.contact), ascendant, orientationOptions);
    const pointA = pointOnCircle(cx, cy, radius, angleA);
    const pointB = pointOnCircle(cx, cy, radius, angleB);
    const className = `chart-antiscia chart-antiscia-${KIND_CLASS[contact.kind]}`;
    parts.push(
      `<line x1="${fmt(pointA.x)}" y1="${fmt(pointA.y)}" x2="${fmt(pointB.x)}" y2="${fmt(pointB.y)}" class="${className}" />`,
    );
  }
  return parts.join('');
}
