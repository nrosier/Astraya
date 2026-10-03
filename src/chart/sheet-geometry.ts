/**
 * One scale knob for every radius, tick, glyph and font in a chart sheet.
 *
 * The layout (#412) follows the classic Astrodienst/Astro-Seek wheel, outside in:
 *
 *   1. the zodiac dial (`zodiacOuter`-`zodiacInner`): the twelve sign glyphs, with sign
 *      boundaries spanning the band;
 *   2. the degree ruler: 1°/5°/10° ticks hanging inward from `zodiacInner`, with no circle
 *      of their own;
 *   3. the planet band (`houseRing`-`planetRingOuter`), the widest ring: each body drawn as a
 *      radial stack of glyph, degree, sign and minutes along its own spoke;
 *   4. the house dial (`aspectCircle`-`houseRing`): a narrow ring holding the house numbers
 *      and the ASC/DSC/MC/IC labels, with a tick at each body's true degree on its outer edge;
 *   5. the aspect disk (r <= `aspectCircle`), where the chords are drawn.
 *
 * Every value is quoted in pixels on an 800x800 canvas and multiplied by `size / 800`, so
 * `resolveSheetGeometry(800)` reproduces those figures exactly and any other size scales
 * proportionally — the sheet has to stay legible as a 2400px PNG or in print.
 *
 * Radii are named fields rather than an array because each is a different *kind* of
 * boundary (a ring edge, a glyph track, a chord limit), and callers reference them by
 * meaning.
 */

/** The size the reference layout's pixel figures below are quoted at. */
const REFERENCE_SIZE = 800;

/**
 * The reference layout, in its own pixels — kept as the original figures rather than
 * pre-divided fractions so the arithmetic is exact at the reference size.
 */
const REFERENCE = {
  zodiacOuter: 380,
  zodiacInner: 330,
  signGlyph: 355,
  // Ticks hang inward from `zodiacInner`; the planet band starts just inside the longest.
  tickMinor: 4,
  tickMedium: 7,
  tickMajor: 11,
  planetRingOuter: 316,
  houseRing: 200,
  aspectCircle: 164,
  bodyTick: 6,
  signGlyphSize: 30,
  bodyGlyphSize: 28,
  stackSignGlyphSize: 16,
  degreeFontSize: 14,
  minuteFontSize: 11,
  retrogradeFontSize: 10,
  houseNumberFontSize: 15,
  axisLabelFontSize: 12,
  axisDegreeFontSize: 11,
  panelFontSize: 16,
  labelMargin: 60,
} as const;

/** Degree intervals the three ruler tick tiers are drawn at. */
export const TICK_INTERVAL_DEG = 1;
export const TICK_MEDIUM_INTERVAL_DEG = 5;
export const TICK_MAJOR_INTERVAL_DEG = 10;

export interface SheetGeometry {
  readonly size: number;
  readonly cx: number;
  readonly cy: number;
  /** The outermost drawn circle: the zodiac dial's outer edge. The four angles run out to here. */
  readonly zodiacOuter: number;
  /** Zodiac dial inner edge, and the circle the degree ruler's ticks hang inward from. */
  readonly zodiacInner: number;
  /** Track the twelve zodiac sign glyphs sit on, centred in the zodiac dial. */
  readonly signGlyphRadius: number;
  /** Outer edge of the planet band — just inside the ruler's longest tick. */
  readonly planetRingOuter: number;
  /** Boundary between the planet band (outside) and the house dial (inside). */
  readonly houseRing: number;
  /** Inner edge of the house dial; aspect chords are drawn strictly within this radius. */
  readonly aspectCircle: number;
  /** Track the numeric house labels and the ASC/DSC/MC/IC labels sit on, centred in the house dial. */
  readonly houseNumberRadius: number;
  readonly tickMinorLength: number;
  readonly tickMediumLength: number;
  readonly tickMajorLength: number;
  /** Length of the tick marking each body's true degree on the house dial's outer edge. */
  readonly bodyTickLength: number;
  readonly signGlyphSize: number;
  readonly bodyGlyphSize: number;
  /** The sign glyph inside a body's radial stack — smaller than the zodiac dial's own. */
  readonly stackSignGlyphSize: number;
  readonly degreeFontSize: number;
  readonly minuteFontSize: number;
  readonly retrogradeFontSize: number;
  readonly houseNumberFontSize: number;
  readonly axisLabelFontSize: number;
  readonly axisDegreeFontSize: number;
  readonly panelFontSize: number;
  /** Space reserved outside `zodiacOuter` for anything drawn beyond the wheel. */
  readonly labelMargin: number;
}

export function resolveSheetGeometry(size: number): SheetGeometry {
  const scaled = (reference: number): number => (size * reference) / REFERENCE_SIZE;
  const houseRing = scaled(REFERENCE.houseRing);
  const aspectCircle = scaled(REFERENCE.aspectCircle);
  return {
    size,
    cx: size / 2,
    cy: size / 2,
    zodiacOuter: scaled(REFERENCE.zodiacOuter),
    zodiacInner: scaled(REFERENCE.zodiacInner),
    signGlyphRadius: scaled(REFERENCE.signGlyph),
    planetRingOuter: scaled(REFERENCE.planetRingOuter),
    houseRing,
    aspectCircle,
    houseNumberRadius: aspectCircle + (houseRing - aspectCircle) / 2,
    tickMinorLength: scaled(REFERENCE.tickMinor),
    tickMediumLength: scaled(REFERENCE.tickMedium),
    tickMajorLength: scaled(REFERENCE.tickMajor),
    bodyTickLength: scaled(REFERENCE.bodyTick),
    signGlyphSize: scaled(REFERENCE.signGlyphSize),
    bodyGlyphSize: scaled(REFERENCE.bodyGlyphSize),
    stackSignGlyphSize: scaled(REFERENCE.stackSignGlyphSize),
    degreeFontSize: scaled(REFERENCE.degreeFontSize),
    minuteFontSize: scaled(REFERENCE.minuteFontSize),
    retrogradeFontSize: scaled(REFERENCE.retrogradeFontSize),
    houseNumberFontSize: scaled(REFERENCE.houseNumberFontSize),
    axisLabelFontSize: scaled(REFERENCE.axisLabelFontSize),
    axisDegreeFontSize: scaled(REFERENCE.axisDegreeFontSize),
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

/** Where one chart's bodies are drawn, within the shared planet band. */
export interface RingBand {
  readonly innerRadius: number;
  readonly outerRadius: number;
  /** Radius a body's leader line starts from, at its true, unspread longitude. */
  readonly trueRadius: number;
  /** Track the body glyphs sit on. */
  readonly glyphRadius: number;
  /** Track the degree (`29°`) of each body's radial stack. Only drawn for a single ring. */
  readonly degreeLabelRadius: number;
  /** Track the sign glyph of each body's radial stack. Only drawn for a single ring. */
  readonly signLabelRadius: number;
  /** Track the minutes (`08'`) of each body's radial stack, innermost. Only drawn for a single ring. */
  readonly minuteLabelRadius: number;
}

/**
 * Divides the planet band (`houseRing` to `planetRingOuter`) into one band per chart ring,
 * innermost first.
 *
 * A single ring gets the whole band and the reference radial stack: glyph outermost, next
 * to the ruler its leader line starts from, then degree, sign and minutes towards the house
 * dial. Stacked rings are too narrow for that stack, so each just centres its glyphs.
 */
export function resolveRingBands(geometry: SheetGeometry, ringCount: number): readonly RingBand[] {
  if (ringCount < 1) throw new Error('resolveRingBands requires at least one ring');
  const span = geometry.planetRingOuter - geometry.houseRing;
  const bandWidth = span / ringCount;
  return Array.from({ length: ringCount }, (_, index) => {
    const innerRadius = geometry.houseRing + bandWidth * index;
    const outerRadius = innerRadius + bandWidth;
    const at = (fraction: number): number => innerRadius + bandWidth * fraction;
    if (ringCount === 1) {
      return {
        innerRadius,
        outerRadius,
        trueRadius: outerRadius,
        glyphRadius: at(0.78),
        degreeLabelRadius: at(0.49),
        signLabelRadius: at(0.31),
        minuteLabelRadius: at(0.14),
      };
    }
    return {
      innerRadius,
      outerRadius,
      trueRadius: at(0.94),
      glyphRadius: at(0.5),
      degreeLabelRadius: at(0.5),
      signLabelRadius: at(0.5),
      minuteLabelRadius: at(0.5),
    };
  });
}
