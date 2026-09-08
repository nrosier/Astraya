/**
 * Chart wheel geometry: rings, degree ticks and house cusps (#39).
 *
 * A deterministic, framework-free module that turns a `HousePositions` into a
 * standalone SVG string — no React, no DOM. That keeps it unit-testable with
 * plain string assertions and directly exportable (e.g. "save as .svg") without
 * a render pass. Bodies (#40), aspect lines (#42) and overlay lines (#148) are
 * layered on top by later issues, drawing into the same coordinate system
 * (`wheelAngle`/`pointOnCircle` below) rather than duplicating it.
 *
 * Orientation and sweep direction (#43) default to the near-universal
 * convention: the Ascendant at the 9 o'clock position, houses running
 * counterclockwise from there (so the Midheaven, wherever it actually falls
 * for the input houses, reads roughly upward rather than at a forced 12
 * o'clock — real geometry, not an idealised quadrant chart). Both are
 * options on `wheelAngle` itself, since bodies (#41, #42) draw into the same
 * coordinate system and must turn with the wheel rather than staying fixed
 * to whatever the default happens to be.
 */
import type { Degrees, HousePositions } from '../ephemeris/types.js';
import { degreesInSign, signOf } from '../astrology/signs.js';

/** Where longitude 0 (`asc-left`, the default) or the Ascendant (`aries-up`) is fixed on screen. */
export type WheelOrientation = 'asc-left' | 'aries-up';

/** Which way increasing longitude sweeps around the wheel. */
export type WheelSweep = 'counterclockwise' | 'clockwise';

/**
 * How a house's cusp spoke is drawn (#43): at its literal computed degree
 * (`equal-degree`, the default — cusps can fall anywhere, so wedges are
 * generally unequal widths for most house systems), or snapped to the
 * boundary of the sign it falls in (`whole-sign` — every wedge becomes
 * exactly one 30-degree sign, the classical whole-sign-wheel look). This is
 * a display choice only: it never changes which house system computed the
 * cusps, so the same chart can be viewed either way.
 */
export type HouseWedgeStyle = 'equal-degree' | 'whole-sign';

export interface WheelOrientationOptions {
  /** Whether the Ascendant or 0° Aries is fixed at the anchor position. Defaults to `asc-left`. */
  readonly orientation?: WheelOrientation;
  /** Which way longitude sweeps around the wheel. Defaults to `counterclockwise`. */
  readonly sweep?: WheelSweep;
}

export interface WheelGeometryOptions extends WheelOrientationOptions {
  /** SVG viewport is `size` x `size` pixels; cusp labels extend beyond it into `labelMargin`. */
  readonly size?: number;
  /** Radial width of the zodiac sign ring, in pixels. */
  readonly zodiacRingWidth?: number;
  /** Radius at which house-cusp spokes start, in pixels. */
  readonly innerRadius?: number;
  /** Spacing of minor degree ticks, in degrees. */
  readonly tickIntervalDeg?: number;
  /** Spacing of major degree ticks, in degrees. */
  readonly majorTickIntervalDeg?: number;
  /** Extra space reserved outside the wheel for cusp labels, in pixels. */
  readonly labelMargin?: number;
  /** How house-cusp spokes are drawn. Defaults to `equal-degree`. */
  readonly houseWedgeStyle?: HouseWedgeStyle;
}

interface ResolvedOptions {
  readonly size: number;
  readonly zodiacRingWidth: number;
  readonly innerRadius: number;
  readonly tickIntervalDeg: number;
  readonly majorTickIntervalDeg: number;
  readonly labelMargin: number;
  readonly houseWedgeStyle: HouseWedgeStyle;
  readonly orientation: WheelOrientation;
  readonly sweep: WheelSweep;
}

const DEFAULT_SIZE = 600;
const DEFAULT_ORIENTATION: WheelOrientation = 'asc-left';
const DEFAULT_SWEEP: WheelSweep = 'counterclockwise';
const DEFAULT_HOUSE_WEDGE_STYLE: HouseWedgeStyle = 'equal-degree';

function resolveOptions(options: WheelGeometryOptions | undefined): ResolvedOptions {
  const size = options?.size ?? DEFAULT_SIZE;
  return {
    size,
    zodiacRingWidth: options?.zodiacRingWidth ?? size * 0.08,
    innerRadius: options?.innerRadius ?? size * 0.14,
    tickIntervalDeg: options?.tickIntervalDeg ?? 1,
    majorTickIntervalDeg: options?.majorTickIntervalDeg ?? 10,
    // Wide enough for a label like "15°23' Sagittarius" to clear the viewBox
    // edge without clipping — verified visually by rendering a real fixture
    // and inspecting the SVG, which is how this margin's absence was caught
    // in the first place.
    labelMargin: options?.labelMargin ?? size * 0.16,
    houseWedgeStyle: options?.houseWedgeStyle ?? DEFAULT_HOUSE_WEDGE_STYLE,
    orientation: options?.orientation ?? DEFAULT_ORIENTATION,
    sweep: options?.sweep ?? DEFAULT_SWEEP,
  };
}

/** The four angular houses, by the standard convention (1=ASC, 4=IC, 7=DC, 10=MC). */
const ANGULAR_HOUSES: readonly number[] = [1, 4, 7, 10];

/** Normalise to the half-open interval [0, 360). */
function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/**
 * Wheel-space angle for an ecliptic longitude, in degrees, measured the way
 * `pointOnCircle` expects: 0 = 3 o'clock, increasing counterclockwise on
 * screen by default. With the default options, the Ascendant always lands at
 * 180 (9 o'clock) and longitude increasing beyond it sweeps counterclockwise
 * through the houses, matching how a chart wheel is conventionally drawn.
 *
 * `orientation: 'aries-up'` fixes 0° Aries at 90 (12 o'clock) instead, so the
 * wheel no longer turns with the Ascendant as the birth time changes — some
 * readers prefer the zodiac itself to stay put. `sweep: 'clockwise'` reverses
 * which way increasing longitude goes. Every caller drawing into this same
 * wheel (glyphs, aspect lines, overlays) must pass the same options, or its
 * layer will drift out of alignment with the ring and cusps.
 */
export function wheelAngle(longitude: Degrees, ascendant: Degrees, options?: WheelOrientationOptions): Degrees {
  const orientation = options?.orientation ?? DEFAULT_ORIENTATION;
  const sweep = options?.sweep ?? DEFAULT_SWEEP;
  const anchorLongitude = orientation === 'aries-up' ? 0 : ascendant;
  const anchorScreenAngle = orientation === 'aries-up' ? 90 : 180;
  const delta = longitude - anchorLongitude;
  return norm360(anchorScreenAngle + (sweep === 'clockwise' ? -delta : delta));
}

/** A point on a circle of the given radius, for a `wheelAngle`-style angle. */
export function pointOnCircle(cx: number, cy: number, radius: number, angleDeg: Degrees): { x: number; y: number } {
  const radians = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy - radius * Math.sin(radians) };
}

function fmt(value: number): string {
  return value.toFixed(2);
}

/** "15°23' Aries" for a longitude, for cusp labels. */
function formatDegreeInSign(longitude: Degrees): string {
  const sign = signOf(longitude);
  const inSign = degreesInSign(longitude);
  const degree = Math.floor(inSign);
  const minute = Math.round((inSign - degree) * 60);
  // A rounded-up 60 (e.g. 29.999...) would print "30'" under the wrong degree.
  const carry = minute === 60;
  return `${String(carry ? degree + 1 : degree)}°${String(carry ? 0 : minute)}' ${sign.name}`;
}

/** Where a cusp is actually drawn, under the given house-wedge style. */
function cuspDisplayLongitude(cuspLongitude: Degrees, style: HouseWedgeStyle): Degrees {
  if (style === 'equal-degree') return cuspLongitude;
  return Math.floor(norm360(cuspLongitude) / 30) * 30;
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
 * Renders the wheel's ring/tick/cusp geometry as a standalone SVG document.
 *
 * Bodies, aspect lines and sign glyphs are deliberately absent — see the
 * module comment for which later issues add them, on top of this same
 * coordinate system.
 */
export function renderWheelSvg(houses: HousePositions, options?: WheelGeometryOptions): string {
  const {
    size,
    zodiacRingWidth,
    innerRadius,
    tickIntervalDeg,
    majorTickIntervalDeg,
    labelMargin,
    houseWedgeStyle,
    orientation,
    sweep,
  } = resolveOptions(options);
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = size / 2 - 2; // small margin so the outer stroke isn't clipped
  const ringInnerRadius = outerRadius - zodiacRingWidth;
  const ascendant = houses.ascendant;
  const orientationOptions: WheelOrientationOptions = { orientation, sweep };

  const parts: string[] = [];

  // Ring boundaries.
  parts.push(circle(cx, cy, outerRadius, 'wheel-ring-outer'));
  parts.push(circle(cx, cy, ringInnerRadius, 'wheel-ring-inner'));

  // Degree ticks and sign-boundary divisions around the zodiac ring.
  for (let degree = 0; degree < 360; degree += tickIntervalDeg) {
    const angle = wheelAngle(degree, ascendant, orientationOptions);
    const isSignBoundary = degree % 30 === 0;
    const isMajorTick = degree % majorTickIntervalDeg === 0;
    if (isSignBoundary) {
      const outer = pointOnCircle(cx, cy, outerRadius, angle);
      const inner = pointOnCircle(cx, cy, ringInnerRadius, angle);
      parts.push(line(outer.x, outer.y, inner.x, inner.y, 'wheel-sign-boundary'));
      continue;
    }
    const tickLength = isMajorTick ? zodiacRingWidth * 0.35 : zodiacRingWidth * 0.15;
    const outer = pointOnCircle(cx, cy, ringInnerRadius + tickLength, angle);
    const inner = pointOnCircle(cx, cy, ringInnerRadius, angle);
    parts.push(line(outer.x, outer.y, inner.x, inner.y, isMajorTick ? 'wheel-tick-major' : 'wheel-tick-minor'));
  }

  // House cusp spokes, with the four angles emphasised and reaching further out.
  for (let house = 1; house <= 12; house += 1) {
    const cuspLongitude = houses.cusps[house];
    if (cuspLongitude === undefined) continue;
    const displayLongitude = cuspDisplayLongitude(cuspLongitude, houseWedgeStyle);
    const angle = wheelAngle(displayLongitude, ascendant, orientationOptions);
    const isAngular = ANGULAR_HOUSES.includes(house);
    const outerEnd = pointOnCircle(cx, cy, isAngular ? outerRadius : ringInnerRadius, angle);
    const innerEnd = pointOnCircle(cx, cy, innerRadius, angle);
    parts.push(line(outerEnd.x, outerEnd.y, innerEnd.x, innerEnd.y, isAngular ? 'wheel-cusp-angle' : 'wheel-cusp'));

    const labelRadius = outerRadius + 14;
    const labelPoint = pointOnCircle(cx, cy, labelRadius, angle);
    parts.push(
      text(
        labelPoint.x,
        labelPoint.y,
        'middle',
        isAngular ? 'wheel-cusp-label wheel-cusp-label-angle' : 'wheel-cusp-label',
        formatDegreeInSign(displayLongitude),
      ),
    );
  }

  // The viewBox extends beyond [0, size] on every side by `labelMargin` so
  // cusp labels (drawn at outerRadius + 14, outside the wheel itself) aren't
  // clipped by the SVG viewport; width/height stay at `size` so the wheel's
  // own diameter still maps to the documented `size` pixels.
  const viewBoxOrigin = -labelMargin;
  const viewBoxSize = size + labelMargin * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(viewBoxOrigin)} ${fmt(viewBoxOrigin)} ${fmt(viewBoxSize)} ${fmt(viewBoxSize)}" ` +
    `width="${String(size)}" height="${String(size)}" class="chart-wheel">` +
    `${parts.join('')}</svg>`
  );
}
