/**
 * A small standalone diagram for the chart's Jones shape (#401) — a visual complement to #398's
 * plain-text "Chart Shape: Bucket" sentence, not a replacement for it.
 *
 * Deliberately decoupled from the real wheel (`multi-wheel.ts`): this draws the *abstract*
 * pattern `jonesShapeOf` found — which arcs are occupied, which are empty, where the groups and
 * (for a Bucket) the handle sit — using this person's actual body longitudes, but with none of
 * the real wheel's houses/signs/aspects/other chrome. That keeps it simple enough to generate
 * independently, the same way `degree-strip.ts`/`emphasis-grid.ts` are their own small renderers
 * fed a narrow slice of `ChartData` rather than panels bolted onto `multi-wheel.ts`.
 *
 * All seven shapes render through one mechanism, with no per-shape special case beyond the
 * handle highlight: `JonesShapeResult.groups` is already exactly "one wedge per occupied arc" —
 * bundle/bowl/locomotive/splash are the one-group case (a single wedge whose width is `span`),
 * seesaw/bucket are the two-group case, splay is three or more. A one-body group (a Bucket's
 * handle, or in principle any isolated single body) draws as a dot with no wedge, since a wedge
 * from a point to itself has no width to show.
 */
import type { JonesShapeResult } from '../astrology/jones-shapes.js';
import type { BodyId, Degrees } from '../ephemeris/types.js';
import { circle, polygon } from './svg-primitives.js';
import { pointOnCircle, wheelAngle } from './wheel.js';

const WEDGE_ARC_STEP_DEG = 4;

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** 0° Aries fixed at 12 o'clock, sweeping counterclockwise — this diagram has no Ascendant of its own to orient by, unlike the real wheel. */
function angleOf(longitude: Degrees): Degrees {
  return wheelAngle(longitude, 0, { orientation: 'aries-up' });
}

/** Same outer-arc-then-back-along-the-inner-arc polygon approximation `multi-wheel.ts`'s own sign wedges use, generalised to an arbitrary start/span instead of a fixed 30°. */
function wedgePolygon(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startLongitude: Degrees,
  spanDegrees: Degrees,
  className: string,
): string {
  const steps: number[] = [];
  for (let offset = 0; offset < spanDegrees; offset += WEDGE_ARC_STEP_DEG) steps.push(offset);
  steps.push(spanDegrees);

  const outerPoints = steps.map((offset) => pointOnCircle(cx, cy, outerRadius, angleOf(startLongitude + offset)));
  const innerPoints = steps
    .map((offset) => pointOnCircle(cx, cy, innerRadius, angleOf(startLongitude + offset)))
    .reverse();
  return polygon([...outerPoints, ...innerPoints], className);
}

/**
 * `positions` must be the same body-longitude map `jonesShapeOf` was called with (i.e. the
 * `BodyId`s in `result.groups`/`result.handle` must all be keys of it) — `chartShapeOf` in
 * `chart-tables.ts` builds exactly this map from `visiblePositions`, so reuse that, not a
 * separately-filtered one, or a group's bodies won't resolve to a longitude.
 */
export function renderJonesShapeDiagramSvg(
  result: JonesShapeResult,
  positions: ReadonlyMap<BodyId, Degrees>,
  size: number,
): string {
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = size * 0.46;
  const innerRadius = size * 0.3;
  const dotRadius = size * 0.4;
  const dotSize = Math.max(2.5, size * 0.018);

  const parts: string[] = [circle(cx, cy, outerRadius, 'chart-shape-ring')];

  for (const group of result.groups) {
    const first = group[0];
    if (first === undefined) continue;
    const firstLongitude = positions.get(first);
    if (firstLongitude === undefined) continue;

    if (group.length >= 2) {
      const last = group[group.length - 1];
      const lastLongitude = last === undefined ? undefined : positions.get(last);
      if (lastLongitude !== undefined) {
        const span = norm360(lastLongitude - firstLongitude);
        parts.push(wedgePolygon(cx, cy, outerRadius, innerRadius, firstLongitude, span, 'chart-shape-wedge'));
      }
    }

    for (const body of group) {
      const longitude = positions.get(body);
      if (longitude === undefined) continue;
      const point = pointOnCircle(cx, cy, dotRadius, angleOf(longitude));
      const isHandle = result.handle !== undefined && body === result.handle;
      parts.push(
        circle(point.x, point.y, dotSize, isHandle ? 'chart-shape-dot chart-shape-handle' : 'chart-shape-dot'),
      );
    }
  }

  return `<svg viewBox="0 0 ${String(size)} ${String(size)}" class="chart-shape-diagram">${parts.join('')}</svg>`;
}
