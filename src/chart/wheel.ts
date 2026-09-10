/**
 * The wheel coordinate system every chart layer shares (#39).
 *
 * `wheelAngle` and `pointOnCircle` are the whole contract: a longitude becomes
 * a screen angle, and an angle plus a radius becomes a point. Rings, ticks,
 * cusps, body glyphs (#40/#41), aspect chords (#42), overlays (#148) and the
 * 90-degree dial all draw through these two functions rather than each
 * deriving its own trigonometry, which is what keeps the layers aligned when
 * the orientation options below change.
 *
 * Radii used to be derived per-file here as `size * 0.08`-style fractions;
 * they now live in `sheet-geometry.ts`, one named layout for the whole sheet.
 * This module is deliberately geometry-only and draws nothing.
 *
 * Orientation and sweep direction (#43) default to the near-universal
 * convention: the Ascendant at the 9 o'clock position, houses running
 * counterclockwise from there (so the Midheaven, wherever it actually falls
 * for the input houses, reads roughly upward rather than at a forced 12
 * o'clock — real geometry, not an idealised quadrant chart).
 */
import type { Degrees } from '../ephemeris/types.js';

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

const DEFAULT_ORIENTATION: WheelOrientation = 'asc-left';
const DEFAULT_SWEEP: WheelSweep = 'counterclockwise';

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
