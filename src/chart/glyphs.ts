/**
 * Vector-path glyphs for bodies, zodiac signs and aspects (#40).
 *
 * Every glyph is authored as plain SVG primitives (`<path>`, `<circle>`,
 * `<rect>`) in a fixed 0-100 coordinate box, with no font dependency — the
 * app's CSP only allows `font-src 'self'` and ships no icon font, and a
 * chart exported as a standalone SVG (see `wheel.ts`) needs to stay
 * self-contained regardless of what fonts the viewer has. `renderGlyph`
 * places one of these into a wheel (or anywhere else) by translating and
 * scaling that 100-unit box to a given center point and pixel size.
 *
 * Coverage follows the issue's checklist: every entry in `BODIES` (#17,
 * including Chiron, both nodes, all three Lilith variants, and the four
 * asteroids), all twelve `SIGNS`, and every `ASPECTS` entry. A south-node
 * glyph is included too (as the north-node horseshoe, mirrored) even
 * though it is not its own `BODIES` entry, since `southNode()` in
 * `bodies.ts` implies callers plot it separately from the north node it is
 * derived from.
 *
 * The major-aspect glyphs (conjunction, sextile, square, trine, opposition)
 * and the zodiac-sign glyphs reproduce their traditional, well-established
 * shapes. The minor-aspect glyphs (semisextile, semisquare, quintile,
 * sesquiquadrate, biquintile, quincunx) and the three lesser-used points
 * (the two non-mean Lilith variants, Chiron, and the four asteroids) don't
 * have one universally agreed sigil the way the majors do — these are
 * original schematic designs in the same visual vocabulary (circles,
 * crosses, crescents, simple curves) rather than a claimed reproduction of
 * a specific historical glyph.
 */

export interface GlyphDefinition {
  readonly key: string;
  /** Raw `<path>`/`<circle>`/`<rect>` tags, coordinates in a 0-100 box. */
  readonly elements: readonly string[];
}

function path(d: string): string {
  return `<path d="${d}" />`;
}

function circle(cx: number, cy: number, r: number, filled = false): string {
  return `<circle cx="${String(cx)}" cy="${String(cy)}" r="${String(r)}"${filled ? ' class="glyph-fill"' : ''} />`;
}

function rect(x: number, y: number, size: number): string {
  return `<rect x="${String(x)}" y="${String(y)}" width="${String(size)}" height="${String(size)}" />`;
}

function glyph(key: string, elements: readonly string[]): GlyphDefinition {
  return { key, elements };
}

// --- Bodies (#17's BODIES, by key) -----------------------------------------

const BODY_GLYPHS: Readonly<Record<string, GlyphDefinition>> = {
  sun: glyph('sun', [circle(50, 50, 22), circle(50, 50, 4, true)]),

  moon: glyph('moon', [path('M62 25 Q28 50 62 75 Q48 50 62 25 Z')]),

  mercury: glyph('mercury', [
    path('M40 30 Q50 12 60 30'), // horns
    circle(50, 45, 15),
    path('M50 60 L50 78 M38 69 L62 69'), // cross
  ]),

  venus: glyph('venus', [circle(50, 38, 15), path('M50 53 L50 85 M35 66 L65 66')]),

  mars: glyph('mars', [
    circle(42, 58, 15),
    path('M55 55 L75 25 M75 25 L62 25 M75 25 L75 38'), // shaft + arrowhead
  ]),

  jupiter: glyph('jupiter', [
    path('M25 25 Q20 45 45 50'), // hook
    path('M25 50 L65 50'), // crossbar
    path('M65 20 L65 80'), // stem
  ]),

  saturn: glyph('saturn', [
    path('M28 32 L52 32'), // top crossbar
    path('M40 20 L40 65'), // stem
    path('M40 65 Q60 70 55 85'), // hook
  ]),

  uranus: glyph('uranus', [
    path('M35 25 L35 65 M65 25 L65 65 M35 45 L65 45'), // H
    circle(50, 45, 6),
    path('M50 65 L50 80'), // stem
  ]),

  neptune: glyph('neptune', [
    path('M30 45 L70 45'), // base bar
    path('M50 45 L50 15'), // center prong
    path('M40 45 Q30 30 38 20'), // left prong
    path('M60 45 Q70 30 62 20'), // right prong
    path('M50 45 L50 85'), // stem
  ]),

  pluto: glyph('pluto', [
    circle(50, 25, 8),
    path('M58 38 Q42 45 58 52 Q50 45 58 38 Z'), // crescent
    path('M50 55 L50 80 M38 67 L62 67'), // cross
  ]),

  meanNode: glyph('meanNode', [
    path('M30 30 Q30 60 50 60 Q70 60 70 30'), // horseshoe
    path('M30 30 Q20 25 25 20'), // left curl
    path('M70 30 Q80 25 75 20'), // right curl
  ]),

  trueNode: glyph('trueNode', [
    path('M30 30 Q30 60 50 60 Q70 60 70 30'),
    path('M30 30 Q20 25 25 20'),
    path('M70 30 Q80 25 75 20'),
  ]),

  meanLilith: glyph('meanLilith', [
    path('M58 25 Q42 32 58 39 Q50 32 58 25 Z'), // crescent
    path('M50 42 L50 80 M38 60 L62 60'), // cross
  ]),

  osculatingLilith: glyph('osculatingLilith', [
    path('M58 25 Q42 32 58 39 Q50 32 58 25 Z'),
    path('M50 42 L50 80 M38 60 L62 60'),
    circle(50, 14, 3, true), // one marker dot
  ]),

  interpolatedLilith: glyph('interpolatedLilith', [
    path('M58 25 Q42 32 58 39 Q50 32 58 25 Z'),
    path('M50 42 L50 80 M38 60 L62 60'),
    circle(44, 14, 3, true), // two marker dots
    circle(56, 14, 3, true),
  ]),

  chiron: glyph('chiron', [circle(50, 32, 10), path('M50 42 L50 80 M50 55 L68 45 M50 55 L68 65')]),

  ceres: glyph('ceres', [circle(50, 30, 10), path('M42 38 Q30 50 35 65')]),

  pallas: glyph('pallas', [path('M50 20 L65 50 L50 80 L35 50 Z'), path('M50 15 L50 85')]),

  juno: glyph('juno', [
    path('M50 20 L50 36 M43 24 L57 32 M57 24 L43 32'), // star
    path('M50 36 L50 80'), // stem
    path('M35 58 L65 58'), // crossbar
  ]),

  vesta: glyph('vesta', [circle(50, 25, 8), path('M35 75 L50 50 L65 75 Z')]),
};

/** The north-node glyph, mirrored vertically. Not a `BODIES` entry itself. */
const SOUTH_NODE_GLYPH: GlyphDefinition = glyph('southNode', [
  path('M30 70 Q30 40 50 40 Q70 40 70 70'),
  path('M30 70 Q20 75 25 80'),
  path('M70 70 Q80 75 75 80'),
]);

export function bodyGlyph(key: string): GlyphDefinition | undefined {
  if (key === 'southNode') return SOUTH_NODE_GLYPH;
  return BODY_GLYPHS[key];
}

// --- Zodiac signs (SIGNS, by name) ------------------------------------------

const SIGN_GLYPHS: Readonly<Record<string, GlyphDefinition>> = {
  // Two horns curling outward from a central stem. Drawn stem-down deliberately:
  // the mirror image is the north-node glyph, so an upside-down Aries reads as a
  // completely different symbol rather than as a rotated one.
  Aries: glyph('Aries', [
    path('M50 75 L50 46'),
    path('M50 48 Q50 25 34 25 Q22 25 24 42'),
    path('M50 48 Q50 25 66 25 Q78 25 76 42'),
  ]),

  Taurus: glyph('Taurus', [circle(50, 60, 15), path('M30 25 Q30 45 45 47 M70 25 Q70 45 55 47')]),

  Gemini: glyph('Gemini', [path('M40 25 L40 75 M60 25 L60 75 M30 25 L70 25 M30 75 L70 75')]),

  // A sideways "69": two spirals in point symmetry about the centre, each a
  // circle trailing a long stroke away from the other. Joining the two circles
  // instead (as this once did) reads as a chain link, not as Cancer.
  Cancer: glyph('Cancer', [
    circle(30, 56, 10),
    path('M30 46 Q30 30 50 30 L74 30'),
    circle(70, 44, 10),
    path('M70 54 Q70 70 50 70 L26 70'),
  ]),

  Leo: glyph('Leo', [circle(42, 42, 14), path('M56 42 Q75 42 75 60 Q75 75 60 72')]),

  Virgo: glyph('Virgo', [
    path('M30 25 L30 75 M45 25 L45 75 M60 25 L60 60'),
    path('M60 60 Q60 75 75 75 Q85 75 85 60 Q85 50 75 50'),
  ]),

  Libra: glyph('Libra', [path('M35 45 Q50 30 65 45'), path('M30 55 L70 55'), path('M25 72 L75 72')]),

  Scorpio: glyph('Scorpio', [
    path('M30 25 L30 70 M45 25 L45 70 M60 25 L60 55'),
    path('M60 55 Q75 55 78 70'),
    path('M78 70 L70 75 M78 70 L82 60'),
  ]),

  Sagittarius: glyph('Sagittarius', [
    path('M30 70 L70 30'),
    path('M70 30 L58 30 M70 30 L70 42'),
    // Perpendicular to the shaft, so it reads as a crossbar; along it, it would
    // be invisible.
    path('M33 53 L47 67'),
  ]),

  // Goat horn then fish tail: an arch whose left leg drops long and whose right
  // leg curls into a closed loop. A single continuous squiggle (as this once
  // was) has neither landmark and reads as no sign in particular.
  Capricorn: glyph('Capricorn', [
    path('M20 76 L20 44 Q20 28 35 28 Q50 28 50 44 L50 56'),
    path('M50 56 Q54 72 66 70 Q80 68 78 54 Q76 42 62 46'),
  ]),

  Aquarius: glyph('Aquarius', [
    path('M20 40 L32 30 L44 40 L56 30 L68 40 L80 30'),
    path('M20 65 L32 55 L44 65 L56 55 L68 65 L80 55'),
  ]),

  Pisces: glyph('Pisces', [path('M35 20 Q20 50 35 80'), path('M65 20 Q80 50 65 80'), path('M35 50 L65 50')]),
};

export function signGlyph(name: string): GlyphDefinition | undefined {
  return SIGN_GLYPHS[name];
}

// --- Aspects (ASPECTS, by key) ----------------------------------------------

const ASPECT_GLYPHS: Readonly<Record<string, GlyphDefinition>> = {
  conjunction: glyph('conjunction', [circle(50, 50, 10), path('M50 40 L50 25')]),

  semisextile: glyph('semisextile', [path('M35 40 Q50 25 65 40'), path('M50 40 L50 65')]),

  semisquare: glyph('semisquare', [path('M35 30 L35 70 L75 70'), path('M35 70 L50 55')]),

  sextile: glyph('sextile', [path('M50 35 L50 65 M37 42.5 L63 57.5 M37 57.5 L63 42.5')]),

  quintile: glyph('quintile', [path('M50 28 L70.9 43.2 L62.9 67.8 L37.1 67.8 L29.1 43.2 Z')]),

  square: glyph('square', [rect(35, 35, 30)]),

  trine: glyph('trine', [path('M50 25 L72 68 L28 68 Z')]),

  sesquiquadrate: glyph('sesquiquadrate', [rect(40, 40, 20), path('M60 60 L75 75')]),

  biquintile: glyph('biquintile', [path('M50 28 L62.9 67.8 L29.1 43.2 L70.9 43.2 L37.1 67.8 Z')]),

  quincunx: glyph('quincunx', [circle(42, 42, 10), path('M50 50 L75 75')]),

  opposition: glyph('opposition', [circle(50, 50, 20), path('M28 50 L72 50')]),
};

export function aspectGlyph(key: string): GlyphDefinition | undefined {
  return ASPECT_GLYPHS[key];
}

/**
 * Places a glyph's 0-100 box centered at `(cx, cy)`, scaled so the box's
 * full width/height equal `size` pixels, as a `<g>` in the caller's SVG.
 */
export function renderGlyph(
  definition: GlyphDefinition,
  cx: number,
  cy: number,
  size: number,
  className: string,
): string {
  const scale = size / 100;
  const tx = cx - size / 2;
  const ty = cy - size / 2;
  return (
    `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})" class="${className}">` +
    `${definition.elements.join('')}</g>`
  );
}
