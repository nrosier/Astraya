/**
 * One scale knob for every radius, tick, glyph and font in a chart sheet.
 *
 * The reference layout this reproduces is specified in absolute pixels on an
 * 800x800 canvas (outer border 380, zodiac ring 376-320, house ring 280,
 * aspect circle 190, sign glyphs at 348, planets at 235, ticks 2/5/8). Every
 * value here is stored as that pixel figure divided by 800 and multiplied back
 * by the caller's `size`, so `resolveSheetGeometry(800)` reproduces the
 * reference layout exactly while any other size scales proportionally — the
 * sheet has to stay legible when rendered much larger than screen size (a
 * 2400px PNG export, print), and a fixed-pixel layout could not do that.
 *
 * The ratios (zodiac band ~15% of the outer radius, aspect circle at ~half
 * of it, a wider planet ring band than before) follow the proportions of
 * Kerykeion's chart drawer (`kerykeion/charts/chart_drawer.py`'s
 * `CircleRadiiConfig`, AGPL-3.0), itself derived from OpenAstro.org — used
 * here as a licensed, inspectable stand-in for the Astrodienst look, since
 * astro.com's own pages aren't fetchable for direct reference. The zodiac
 * ring's outer edge sits close to the outer border rather than 40px inside
 * it, and the planet ring band (`aspectCircle` to `houseRing`, where bodies
 * are actually placed) is proportionally wider, matching that reference's
 * more spacious, less cramped centre.
 *
 * Radii are kept as named fields rather than an array because each one is a
 * different *kind* of boundary (a ring edge, a glyph track, a chord limit),
 * and callers reference them by meaning; the previous per-file `size * 0.08`
 * arithmetic scattered across the renderers had no such shared vocabulary.
 */

/** The size the reference layout's pixel figures below are quoted at. */
const REFERENCE_SIZE = 800;

/**
 * The reference layout, in its own pixels. Multiplied by `size / 800` on the
 * way out — kept as the original figures rather than pre-divided fractions so
 * the arithmetic is exact at the reference size instead of landing on
 * 220.00000000000003.
 */
const REFERENCE = {
  outerBorder: 380,
  zodiacOuter: 376,
  zodiacInner: 320,
  houseRing: 280,
  aspectCircle: 190,
  // Centred in the narrower zodiac band (376-320) now that it sits close to the outer
  // edge rather than 40px inside it — kept at the band's midpoint rather than the old
  // absolute figure, which would now coincide with `zodiacInner` itself.
  signGlyph: 348,
  tickMinor: 2,
  tickMedium: 5,
  tickMajor: 8,
  signGlyphSize: 34,
  bodyGlyphSize: 30,
  degreeFontSize: 15,
  houseNumberFontSize: 17,
  panelFontSize: 16,
  labelMargin: 60,
} as const;

/** Degree intervals the three zodiac tick tiers are drawn at. */
export const TICK_INTERVAL_DEG = 1;
export const TICK_MEDIUM_INTERVAL_DEG = 5;
export const TICK_MAJOR_INTERVAL_DEG = 10;

export interface SheetGeometry {
  readonly size: number;
  readonly cx: number;
  readonly cy: number;
  /** R0: the outermost drawn circle. */
  readonly outerBorder: number;
  /** R1: zodiac sign ring, outer edge. */
  readonly zodiacOuter: number;
  /** R2: zodiac sign ring inner edge, and the circle degree ticks stand on. */
  readonly zodiacInner: number;
  /** R3: boundary between the house-number band (outside) and the chart rings (inside). */
  readonly houseRing: number;
  /** R4: aspect chords are drawn strictly within this radius. */
  readonly aspectCircle: number;
  /** Track the twelve zodiac sign glyphs sit on, centred in the R1-R2 ring. */
  readonly signGlyphRadius: number;
  /** Track the numeric house labels 1-12 sit on, centred in the R2-R3 band. */
  readonly houseNumberRadius: number;
  readonly tickMinorLength: number;
  readonly tickMediumLength: number;
  readonly tickMajorLength: number;
  readonly signGlyphSize: number;
  readonly bodyGlyphSize: number;
  readonly degreeFontSize: number;
  readonly houseNumberFontSize: number;
  readonly panelFontSize: number;
  /** Space reserved outside `outerBorder` for anything drawn beyond the wheel. */
  readonly labelMargin: number;
}

export function resolveSheetGeometry(size: number): SheetGeometry {
  const scaled = (reference: number): number => (size * reference) / REFERENCE_SIZE;
  const zodiacInner = scaled(REFERENCE.zodiacInner);
  const houseRing = scaled(REFERENCE.houseRing);
  return {
    size,
    cx: size / 2,
    cy: size / 2,
    outerBorder: scaled(REFERENCE.outerBorder),
    zodiacOuter: scaled(REFERENCE.zodiacOuter),
    zodiacInner,
    houseRing,
    aspectCircle: scaled(REFERENCE.aspectCircle),
    signGlyphRadius: scaled(REFERENCE.signGlyph),
    houseNumberRadius: houseRing + (zodiacInner - houseRing) / 2,
    tickMinorLength: scaled(REFERENCE.tickMinor),
    tickMediumLength: scaled(REFERENCE.tickMedium),
    tickMajorLength: scaled(REFERENCE.tickMajor),
    signGlyphSize: scaled(REFERENCE.signGlyphSize),
    bodyGlyphSize: scaled(REFERENCE.bodyGlyphSize),
    degreeFontSize: scaled(REFERENCE.degreeFontSize),
    houseNumberFontSize: scaled(REFERENCE.houseNumberFontSize),
    panelFontSize: scaled(REFERENCE.panelFontSize),
    labelMargin: scaled(REFERENCE.labelMargin),
  };
}

/**
 * Where a stacked panel is placed. The sheet decides `x`/`y`/`width`; the
 * panel decides its own height, since only it knows how many rows its data
 * needs — which is what keeps `chart-sheet.ts` free of per-panel magic
 * numbers that would silently overlap when a chart has more bodies.
 */
export interface PanelLayout {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

export interface PanelRender {
  readonly markup: string;
  /** Vertical space actually consumed, measured from `layout.y`. */
  readonly height: number;
}

/** Where one chart's bodies, cusps and own aspect web are drawn, within the shared wheel. */
export interface RingBand {
  readonly innerRadius: number;
  readonly outerRadius: number;
  /** Radius a body's leader line starts from — its true, unspread longitude. */
  readonly trueRadius: number;
  /** Track the body glyphs sit on. */
  readonly glyphRadius: number;
  /** Track each body's degree/minute annotation sits on. */
  readonly degreeLabelRadius: number;
}

/**
 * Divides the R4-R3 space into one band per chart ring, innermost first.
 *
 * The aspect disk (r <= R4) is deliberately left out of the division: aspect
 * chords need the whole inner disk regardless of how many rings are drawn, so
 * bands grow inward from R3 towards R4 and stop there. For a single ring the
 * one band it produces *is* the reference layout's planetary placement ring —
 * which is what lets one renderer draw both a natal wheel and a bi-/tri-wheel
 * instead of two renderers that would drift apart.
 */
export function resolveRingBands(geometry: SheetGeometry, ringCount: number): readonly RingBand[] {
  if (ringCount < 1) throw new Error('resolveRingBands requires at least one ring');
  const span = geometry.houseRing - geometry.aspectCircle;
  const bandWidth = span / ringCount;
  return Array.from({ length: ringCount }, (_, index) => {
    // Index 0 is the innermost band, so it starts at the aspect circle.
    const innerRadius = geometry.aspectCircle + bandWidth * index;
    const outerRadius = innerRadius + bandWidth;
    return {
      innerRadius,
      outerRadius,
      // Glyphs at the band's midpoint (r=185 for a single ring, matching the
      // reference layout), degree annotations outward of them and leader lines
      // inward, so a leader line back to a true longitude can never cross the
      // annotation text of the glyph beside it.
      trueRadius: innerRadius + bandWidth * 0.08,
      glyphRadius: innerRadius + bandWidth * 0.5,
      degreeLabelRadius: innerRadius + bandWidth * 0.83,
    };
  });
}
