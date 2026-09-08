/**
 * The 90-degree dial (#30, #148).
 *
 * A dial degree (`dialPosition`, #30) collapses conjunction, square, and
 * opposition to the same 0-90 value, but a single point per body would throw
 * away which of the four 90-degree arms it actually falls in — so, following
 * the traditional cosmobiology dial, each body is plotted at all four arms
 * (`longitude mod 90`, `+90`, `+180`, `+270`, i.e. its real longitude and the
 * three points 90/180/270 degrees around from it). Two bodies in a hard
 * aspect then have a pair of arms that land on the very same point, which is
 * the whole reason to draw the dial. `dialArmLongitudes` computes those four
 * synthetic longitudes; body placement is then just `renderGlyphRingSvg`
 * (#41) fed all four, reusing its collision-spreading and leader-line logic
 * rather than duplicating it — overlapping arms (an aspect hit) get nudged
 * apart for legibility exactly like a stellium would be, with the leader
 * line still pointing at the true coincidence.
 *
 * The ring itself (`renderDial90RingSvg`) is a plain 360-degree circle whose
 * tick labels repeat the 0-90 scale in each of the four quadrants, so a
 * reader can look up any arm's dial degree directly, in whichever quadrant
 * it happens to land.
 */
import type { MidpointTreeHit } from '../astrology/midpoints.js';
import { dialPosition } from '../astrology/midpoints.js';
import type { BodyId, Degrees } from '../ephemeris/types.js';
import type { GlyphLayoutInput, GlyphRingOptions } from './glyph-layout.js';
import { renderGlyphRingSvg } from './glyph-layout.js';
import { pointOnCircle } from './wheel.js';

const ARM_COUNT = 4;

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** The four synthetic longitudes (0-360) a longitude's dial position occupies, 90 degrees apart. */
export function dialArmLongitudes(longitude: Degrees): readonly Degrees[] {
  const base = dialPosition(longitude);
  return Array.from({ length: ARM_COUNT }, (_, arm) => base + 90 * arm);
}

/** Fixes dial degree 0 at 12 o'clock, sweeping counterclockwise — this module's own anchor. */
const DIAL_ANCHOR_OPTIONS = { orientation: 'aries-up', sweep: 'counterclockwise' } as const;

function dialAngle(syntheticLongitude: Degrees): Degrees {
  return norm360(90 + syntheticLongitude);
}

export interface Dial90GeometryOptions {
  readonly size?: number;
  readonly ringWidth?: number;
  readonly tickIntervalDeg?: number;
  readonly majorTickIntervalDeg?: number;
  readonly labelMargin?: number;
}

interface ResolvedGeometry {
  readonly size: number;
  readonly ringWidth: number;
  readonly tickIntervalDeg: number;
  readonly majorTickIntervalDeg: number;
  readonly labelMargin: number;
}

const DEFAULT_SIZE = 600;

function resolveGeometry(options: Dial90GeometryOptions | undefined): ResolvedGeometry {
  const size = options?.size ?? DEFAULT_SIZE;
  return {
    size,
    ringWidth: options?.ringWidth ?? size * 0.08,
    tickIntervalDeg: options?.tickIntervalDeg ?? 1,
    majorTickIntervalDeg: options?.majorTickIntervalDeg ?? 10,
    labelMargin: options?.labelMargin ?? size * 0.16,
  };
}

function fmt(value: number): string {
  return value.toFixed(2);
}

function line(x1: number, y1: number, x2: number, y2: number, className: string): string {
  return `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" class="${className}" />`;
}

function circle(cx: number, cy: number, r: number, className: string): string {
  return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" class="${className}" />`;
}

function text(x: number, y: number, anchor: string, className: string, content: string): string {
  return `<text x="${fmt(x)}" y="${fmt(y)}" text-anchor="${anchor}" class="${className}">${content}</text>`;
}

/**
 * Renders the dial's ring/tick geometry as a standalone SVG document — the
 * 90-degree analogue of `renderWheelSvg` (#39), with a quadrant boundary
 * every 90 degrees (instead of a sign boundary every 30) and its 0-90 tick
 * label scale repeated in each of the four quadrants.
 */
export function renderDial90RingSvg(options?: Dial90GeometryOptions): string {
  const { size, ringWidth, tickIntervalDeg, majorTickIntervalDeg, labelMargin } = resolveGeometry(options);
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = size / 2 - 2;
  const ringInnerRadius = outerRadius - ringWidth;

  const parts: string[] = [];
  parts.push(circle(cx, cy, outerRadius, 'dial90-ring-outer'));
  parts.push(circle(cx, cy, ringInnerRadius, 'dial90-ring-inner'));

  for (let quadrant = 0; quadrant < ARM_COUNT; quadrant += 1) {
    for (let degree = 0; degree < 90; degree += tickIntervalDeg) {
      const angle = dialAngle(quadrant * 90 + degree);
      const isQuadrantBoundary = degree === 0;
      const isMajorTick = degree % majorTickIntervalDeg === 0;
      if (isQuadrantBoundary) {
        const outer = pointOnCircle(cx, cy, outerRadius, angle);
        const inner = pointOnCircle(cx, cy, ringInnerRadius, angle);
        parts.push(line(outer.x, outer.y, inner.x, inner.y, 'dial90-quadrant-boundary'));
        continue;
      }
      const tickLength = isMajorTick ? ringWidth * 0.35 : ringWidth * 0.15;
      const outer = pointOnCircle(cx, cy, ringInnerRadius + tickLength, angle);
      const inner = pointOnCircle(cx, cy, ringInnerRadius, angle);
      parts.push(line(outer.x, outer.y, inner.x, inner.y, isMajorTick ? 'dial90-tick-major' : 'dial90-tick-minor'));

      if (isMajorTick) {
        const labelPoint = pointOnCircle(cx, cy, outerRadius + 14, angle);
        parts.push(text(labelPoint.x, labelPoint.y, 'middle', 'dial90-tick-label', `${String(degree)}°`));
      }
    }
  }

  const viewBoxOrigin = -labelMargin;
  const viewBoxSize = size + labelMargin * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(viewBoxOrigin)} ${fmt(viewBoxOrigin)} ${fmt(viewBoxSize)} ${fmt(viewBoxSize)}" ` +
    `width="${String(size)}" height="${String(size)}" class="chart-dial90">` +
    `${parts.join('')}</svg>`
  );
}

/**
 * Places body glyphs on the dial ring by expanding each body to its four
 * dial arms (`dialArmLongitudes`) and delegating straight to
 * `renderGlyphRingSvg` (#41) — collision spreading and leader lines are then
 * exactly the wheel's own logic, so two arms landing on the same point (a
 * hard-aspect hit) are nudged apart for legibility just like a stellium,
 * with the leader line still pointing at the true coincidence.
 */
export function renderDial90BodiesSvg(
  positions: readonly GlyphLayoutInput[],
  cx: number,
  cy: number,
  glyphRadius: number,
  trueRadius: number,
  options?: Omit<GlyphRingOptions, 'orientation' | 'sweep'>,
): string {
  const arms: GlyphLayoutInput[] = positions.flatMap((position) =>
    dialArmLongitudes(position.longitude).map((longitude) => ({ key: position.key, longitude })),
  );
  return renderGlyphRingSvg(arms, 0, cx, cy, glyphRadius, trueRadius, { ...options, ...DIAL_ANCHOR_OPTIONS });
}

/**
 * Marks each midpoint-tree hit (#30) at all four dial arms of its pair's
 * midpoint — `hit.body` falls, within `hit.orb` dial degrees, on one of
 * those arms, so the marker shows where on the ring to look for the
 * coincidence, labelled with all three bodies so the structure ("body is
 * conjunct/square/opposite the a/b midpoint") is legible without
 * cross-referencing anything else.
 */
export function renderDial90MidpointHitsSvg(
  hits: readonly MidpointTreeHit[],
  keyOf: (body: BodyId) => string,
  cx: number,
  cy: number,
  radius: number,
): string {
  const parts: string[] = [];
  for (const hit of hits) {
    const label = `${keyOf(hit.body)}=${keyOf(hit.a)}/${keyOf(hit.b)}`;
    for (const syntheticLongitude of dialArmLongitudes(hit.midpoint)) {
      const angle = dialAngle(syntheticLongitude);
      const point = pointOnCircle(cx, cy, radius, angle);
      parts.push(circle(point.x, point.y, 4, 'dial90-midpoint-hit'));
      parts.push(text(point.x, point.y - 8, 'middle', 'dial90-midpoint-hit-label', label));
    }
  }
  return parts.join('');
}
