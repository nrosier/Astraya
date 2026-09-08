/**
 * Aspect web rendering: chords across the wheel's inner circle (#42).
 *
 * Draws one line per already-computed `Aspect` (#24) from one body's true
 * longitude to the other's, at a fixed radius — conventionally the inner
 * circle `wheel.ts` (#39) leaves for house-cusp spokes to converge on, not
 * wherever collision spreading (#41) happened to draw that body's glyph, so
 * the web reflects exact zodiacal position regardless of how crowded the
 * glyph ring got.
 *
 * Styling and the "applying vs separating" distinction are left to CSS: each
 * line carries a class per aspect key (`chart-aspect-square`, ...) and one
 * for its direction (`chart-aspect-applying`/`chart-aspect-separating`),
 * matching the rest of `src/chart/**`, which never bakes colors into the
 * generated markup. `filterAspectsForDisplay` implements the toggles
 * ("by aspect type", "by orb tightness") as a plain filter over `Aspect[]`
 * — orb and aspect key are already on every `Aspect`, so no separate
 * bookkeeping is needed to support a future UI control for either.
 */
import type { AspectFamily } from '../astrology/aspects.js';
import type { Aspect } from '../astrology/aspects.js';
import type { BodyId, Degrees } from '../ephemeris/types.js';
import type { WheelOrientationOptions } from './wheel.js';
import { pointOnCircle, wheelAngle } from './wheel.js';

export interface AspectDisplayFilter {
  /** Only these aspect keys are shown; omit to show every aspect present. */
  readonly visibleAspectKeys?: ReadonlySet<string> | readonly string[];
  /** Only these families are shown; omit to show both major and minor. */
  readonly visibleFamilies?: readonly AspectFamily[];
  /** Drop any aspect whose orb is wider than this, in degrees. */
  readonly maxOrb?: Degrees;
}

/** Applies the aspect-type and orb-tightness display toggles to a computed aspect list. */
export function filterAspectsForDisplay(
  aspects: readonly Aspect[],
  filter: AspectDisplayFilter = {},
): readonly Aspect[] {
  const keys = filter.visibleAspectKeys ? new Set(filter.visibleAspectKeys) : undefined;
  const families = filter.visibleFamilies ? new Set(filter.visibleFamilies) : undefined;
  return aspects.filter((aspect) => {
    if (keys && !keys.has(aspect.aspect.key)) return false;
    if (families && !families.has(aspect.aspect.family)) return false;
    if (filter.maxOrb !== undefined && aspect.orb > filter.maxOrb) return false;
    return true;
  });
}

function fmt(value: number): string {
  return value.toFixed(2);
}

/**
 * Renders one `<line>` per aspect, chording the circle of radius `radius`
 * centered at `(cx, cy)`. `longitudeOf` resolves each aspect's two bodies to
 * their true ecliptic longitude; `cx`/`cy`/`ascendant` must match the
 * `renderWheelSvg` call this is layered onto (#39), and so must
 * `orientation`/`sweep` (#43) if that call used anything other than the
 * defaults.
 */
export function renderAspectWebSvg(
  aspects: readonly Aspect[],
  longitudeOf: (body: BodyId) => Degrees,
  ascendant: Degrees,
  cx: number,
  cy: number,
  radius: number,
  orientationOptions?: WheelOrientationOptions,
): string {
  const parts: string[] = [];
  for (const aspect of aspects) {
    const angleA = wheelAngle(longitudeOf(aspect.bodyA), ascendant, orientationOptions);
    const angleB = wheelAngle(longitudeOf(aspect.bodyB), ascendant, orientationOptions);
    const pointA = pointOnCircle(cx, cy, radius, angleA);
    const pointB = pointOnCircle(cx, cy, radius, angleB);
    const direction = aspect.applying ? 'applying' : 'separating';
    const className = `chart-aspect chart-aspect-${aspect.aspect.key} chart-aspect-${direction}`;
    parts.push(
      `<line x1="${fmt(pointA.x)}" y1="${fmt(pointA.y)}" x2="${fmt(pointB.x)}" y2="${fmt(pointB.y)}" class="${className}" />`,
    );
  }
  return parts.join('');
}
