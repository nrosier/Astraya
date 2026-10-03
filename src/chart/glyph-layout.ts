/**
 * Glyph collision spreading, with leader lines back to the true degree (#41).
 *
 * Stelliums — several bodies within a couple of degrees of each other — are
 * the normal case for a chart wheel, not an edge case, so glyphs must be
 * nudged apart to stay legible rather than overlapping. `spreadGlyphs` is the
 * pure geometry: it takes each point's true longitude and returns a
 * `displayLongitude` far enough from its neighbours, keeping the true value
 * alongside it so a caller can draw a leader line back to where the body
 * actually is. `renderGlyphRingSvg` does exactly that: it places each body's
 * glyph (`glyphs.ts`, #40) at its spread position on the wheel's coordinate
 * system (`wheelAngle`/`pointOnCircle`, #39) and draws a short leader line
 * from a tick at the true degree to the glyph, but only for glyphs that
 * actually moved — most of a chart's points have no neighbours close enough
 * to need one.
 *
 * Spreading algorithm: cut the circle at its single largest gap, so no
 * cluster of overlapping glyphs ever straddles the 0/360 wrap point, then
 * unroll the remaining points onto a line in their original circular order.
 * Repeatedly push apart any adjacent pair closer than `minSeparationDeg` by
 * splitting the deficit between them — a fixed cap of relaxation passes,
 * which converges geometrically for any input that can actually fit (the
 * cap only matters for a pathological input that asks for more total
 * separation than fits around the circle, e.g. many bodies at a large
 * `minSeparationDeg`). Order along the circle is preserved throughout, so
 * leader lines never cross each other, and the whole function is pure: the
 * same input always produces the same output, with ties at an identical
 * longitude broken by input order rather than by anything non-deterministic.
 */
import type { Degrees } from '../ephemeris/types.js';
import { bodyGlyph, renderGlyph } from './glyphs.js';
import { baselineOffset, fmt, text } from './svg-primitives.js';
import type { WheelOrientationOptions } from './wheel.js';
import { pointOnCircle, wheelAngle } from './wheel.js';

export interface GlyphLayoutInput {
  readonly key: string;
  readonly longitude: Degrees;
  /** Draws a small `R` beside the glyph. */
  readonly retrograde?: boolean;
}

export interface GlyphPlacement {
  readonly key: string;
  /** The body's true ecliptic longitude, unchanged from the input. */
  readonly longitude: Degrees;
  /** Where to actually draw the glyph, after spreading. */
  readonly displayLongitude: Degrees;
}

const DEFAULT_MIN_SEPARATION_DEG = 6;
const MAX_RELAXATION_PASSES = 200;

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/**
 * Spreads overlapping glyphs apart along the zodiac circle. `minSeparationDeg`
 * is the minimum longitude gap kept between any two adjacent display
 * positions; points already that far apart are left exactly where they are.
 */
export function spreadGlyphs(
  points: readonly GlyphLayoutInput[],
  minSeparationDeg: number = DEFAULT_MIN_SEPARATION_DEG,
): readonly GlyphPlacement[] {
  if (points.length === 0) return [];
  if (points.length === 1) {
    const [only] = points;
    if (!only) throw new Error('unreachable: length-1 array has no first element');
    return [{ key: only.key, longitude: only.longitude, displayLongitude: only.longitude }];
  }

  const indexed = points.map((p, index) => ({ ...p, index }));
  const sorted = [...indexed].sort((a, b) => a.longitude - b.longitude || a.index - b.index);

  // Cut the circle at its largest gap so no overlapping cluster straddles
  // the 0/360 wrap point.
  let cutIndex = 0;
  let largestGap = -Infinity;
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    const next = sorted[(i + 1) % sorted.length];
    if (!current || !next) throw new Error('unreachable: index within sorted.length');
    const gap = i === sorted.length - 1 ? next.longitude + 360 - current.longitude : next.longitude - current.longitude;
    if (gap > largestGap) {
      largestGap = gap;
      cutIndex = (i + 1) % sorted.length;
    }
  }
  const rotated = [...sorted.slice(cutIndex), ...sorted.slice(0, cutIndex)];

  // Unroll onto a monotonically non-decreasing line: points before the cut
  // wrapped past 360, so add a full turn to keep the sequence increasing.
  const base = rotated[0]?.longitude;
  if (base === undefined) throw new Error('unreachable: rotated has the same length as points');
  const line = rotated.map((p) => (p.longitude < base ? p.longitude + 360 : p.longitude));

  for (let pass = 0; pass < MAX_RELAXATION_PASSES; pass += 1) {
    let moved = false;
    for (let i = 0; i < line.length - 1; i += 1) {
      const a = line[i];
      const b = line[i + 1];
      if (a === undefined || b === undefined) throw new Error('unreachable: index within line.length');
      const gap = b - a;
      if (gap < minSeparationDeg) {
        const deficit = (minSeparationDeg - gap) / 2;
        line[i] = a - deficit;
        line[i + 1] = b + deficit;
        moved = true;
      }
    }
    if (!moved) break;
  }

  const byOriginalIndex = new Map<number, GlyphPlacement>();
  rotated.forEach((p, i) => {
    const displayLongitude = line[i];
    if (displayLongitude === undefined) throw new Error('unreachable: index within line.length');
    byOriginalIndex.set(p.index, { key: p.key, longitude: p.longitude, displayLongitude: norm360(displayLongitude) });
  });

  // Returned in the caller's original order, not the internal rotated order
  // used to resolve the circle's wrap point.
  return indexed.map((p) => {
    const placement = byOriginalIndex.get(p.index);
    if (!placement) throw new Error('unreachable: every input index is placed exactly once');
    return placement;
  });
}

export interface GlyphRingOptions extends WheelOrientationOptions {
  /** Minimum longitude gap kept between adjacent glyphs. Defaults to 6°. */
  readonly minSeparationDeg?: number;
  /** Glyph box size, in pixels (see `renderGlyph`). Defaults to 24. */
  readonly glyphSize?: number;
  /** Where a spread glyph's leader line ends. Defaults to `glyphRadius` (the glyph's centre). */
  readonly leaderEndRadius?: number;
  /** Font size of the retrograde `R`. Defaults to 40% of `glyphSize`. */
  readonly retrogradeFontSize?: number;
}

/**
 * An invisible circle covering a symbol's whole box, so a click anywhere on it hits — the
 * glyph itself is stroked paths with no fill, which are only hit-testable on the stroke pixels
 * (`@astrodraw/astrochart`'s `ADD_CLICK_AREA` solves the same problem with a transparent rect).
 * `pointer-events="all"` makes it hittable despite `fill="none"`, and the explicit
 * `fill`/`stroke` keep it invisible in an exported SVG with no stylesheet (#412).
 */
export function hitAreaCircle(cx: number, cy: number, r: number): string {
  return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" class="chart-hit-area" fill="none" stroke="none" pointer-events="all" />`;
}

/**
 * Renders body glyphs on the wheel at `glyphRadius`, spread apart per
 * `spreadGlyphs`, each with a leader line from a tick at `trueRadius` (its
 * true degree) back to the glyph — drawn only for glyphs that actually
 * moved, since most points in a typical chart have no close neighbours.
 * `cx`/`cy`/`ascendant` must match the `renderWheelSvg` call this is layered
 * onto (#39), and so must `orientation`/`sweep` (#43) if that call used
 * anything other than the defaults.
 */
export function renderGlyphRingSvg(
  positions: readonly GlyphLayoutInput[],
  ascendant: Degrees,
  cx: number,
  cy: number,
  glyphRadius: number,
  trueRadius: number,
  options?: GlyphRingOptions,
): string {
  const minSeparationDeg = options?.minSeparationDeg ?? DEFAULT_MIN_SEPARATION_DEG;
  const glyphSize = options?.glyphSize ?? 24;
  const placements = spreadGlyphs(positions, minSeparationDeg);

  const leaderEndRadius = options?.leaderEndRadius ?? glyphRadius;
  const retrogradeFontSize = options?.retrogradeFontSize ?? glyphSize * 0.4;
  const retrogradeByKey = new Map(positions.map((p) => [p.key, p.retrograde === true]));

  const parts: string[] = [];
  for (const placement of placements) {
    const definition = bodyGlyph(placement.key);
    if (!definition) continue; // unknown key: nothing to draw for it

    const displayAngle = wheelAngle(placement.displayLongitude, ascendant, options);
    const glyphPoint = pointOnCircle(cx, cy, glyphRadius, displayAngle);
    const groupParts: string[] = [hitAreaCircle(glyphPoint.x, glyphPoint.y, glyphSize * 0.62)];

    if (Math.abs(placement.displayLongitude - placement.longitude) > 1e-9) {
      const trueAngle = wheelAngle(placement.longitude, ascendant, options);
      const truePoint = pointOnCircle(cx, cy, trueRadius, trueAngle);
      const endPoint = pointOnCircle(cx, cy, leaderEndRadius, displayAngle);
      groupParts.push(
        `<line x1="${fmt(truePoint.x)}" y1="${fmt(truePoint.y)}" x2="${fmt(endPoint.x)}" y2="${fmt(endPoint.y)}" class="chart-glyph-leader" />`,
      );
    }

    groupParts.push(
      renderGlyph(definition, glyphPoint.x, glyphPoint.y, glyphSize, `chart-glyph chart-glyph-${placement.key}`),
    );

    if (retrogradeByKey.get(placement.key) === true) {
      groupParts.push(
        text(
          glyphPoint.x + glyphSize * 0.55,
          glyphPoint.y + glyphSize * 0.4 + baselineOffset(retrogradeFontSize),
          'start',
          'chart-retrograde',
          'R',
          retrogradeFontSize,
        ),
      );
    }

    parts.push(`<g class="chart-point" data-body="${placement.key}">${groupParts.join('')}</g>`);
  }
  return parts.join('');
}
