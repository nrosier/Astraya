/**
 * The chart wheel: one to three charts drawn as concentric rings around a
 * shared center, on the layout `sheet-geometry.ts` resolves.
 *
 * One renderer covers both cases deliberately. A single ring is not a special
 * layout, it is `resolveRingBands(geometry, 1)` — the one band it returns *is*
 * the reference layout's planetary placement ring — so a natal wheel and a
 * bi-/tri-wheel cannot drift apart in tick tiers, glyph conventions or ring
 * radii the way two separate renderers would.
 *
 * Every ring shares one wheel-space anchor — the innermost ring's Ascendant,
 * by convention the natal/base chart's — so a given ecliptic degree lands at
 * the same angular position in every ring; only the radius changes per ring.
 * That's the standard real-world bi-wheel convention, and it falls out of
 * reusing `wheelAngle`/`pointOnCircle` (#39) unchanged for every ring rather
 * than re-deriving each ring's own orientation from its own Ascendant, which
 * would make the rings spin independently of each other and defeat the point
 * of overlaying them.
 *
 * A ring's glyphs go through `renderGlyphRingSvg` exactly as before, so
 * collision spreading (#40/#41) is reused per ring, unmodified — each ring
 * spreads only its own bodies, at its own band's radii. Spreading stays
 * angular rather than nudging a crowded glyph radially: the leader line back
 * to the true degree already says where the body really is, and a second
 * radius for planets would leave the degree annotations ragged.
 *
 * The layout itself (#412) is the classic one, outside in: zodiac dial, degree
 * ruler, the planet band where every ring's bodies sit, the narrow house dial,
 * then the aspect disk — see `sheet-geometry.ts`. The four angles run from the
 * aspect circle out to the zodiac dial's edge, never across the aspect web.
 *
 * Every clickable symbol (body, sign, aspect chord) is a `<g>` carrying
 * `data-body`/`data-sign`/`data-aspect-body-*` plus an invisible hit area, so
 * the screen can isolate it on click and dim everything else by attribute.
 *
 * Aspect chords — a ring's own and cross-ring ones alike — end on the aspect
 * circle, so they never cross the bands carrying glyphs. Conjunctions are excluded from
 * the web on purpose — a conjunction is two glyphs at nearly the same degree,
 * which the wheel already shows directly, and its chord would be a dot.
 *
 * Ring labels are a fixed legend in the corner, not radial text: text drawn
 * at a wheel-space angle (as every other label here is) turns upside-down on
 * the far side of the circle as the chart rotates, and a legend sidesteps
 * that without needing to reserve one "safe" angle that's never crowded.
 */
import type { Aspect } from '../astrology/aspects.js';
import { SIGNS, degreesInSign } from '../astrology/signs.js';
import type { BodyId, Degrees, HousePositions } from '../ephemeris/types.js';
import { renderAspectWebSvg, renderCrossRingAspectWebSvg } from './aspect-web.js';
import type { GlyphLayoutInput } from './glyph-layout.js';
import { bodyAttributes, hitAreaCircle, renderGlyphRingSvg, spreadGlyphs } from './glyph-layout.js';
import { renderGlyph, signGlyph } from './glyphs.js';
import { baselineOffset, circle, escapeXml, fmt, line, polygon, text } from './svg-primitives.js';
import type { RingBand, SheetGeometry } from './sheet-geometry.js';
import {
  TICK_MAJOR_INTERVAL_DEG,
  TICK_MEDIUM_INTERVAL_DEG,
  resolveRingBands,
  resolveSheetGeometry,
} from './sheet-geometry.js';
import type { HouseWedgeStyle, SignWedgeStyle, WheelOrientationOptions } from './wheel.js';
import { pointOnCircle, wheelAngle } from './wheel.js';

/** The four angular houses, by the standard convention (1=ASC, 4=IC, 7=DC, 10=MC). */
const ANGULAR_HOUSES: readonly number[] = [1, 4, 7, 10];

/** One chart to draw as a ring, innermost ring first (index 0). */
export interface WheelRingInput {
  /** Shown in the corner legend, e.g. "Natal" or "Solar return 2026". */
  readonly label: string;
  readonly houses: HousePositions;
  readonly bodies: readonly {
    readonly body: BodyId;
    readonly key: string;
    readonly longitude: Degrees;
    readonly retrograde?: boolean;
  }[];
  /**
   * This ring's own aspects (e.g. a natal chart's aspect set), drawn as a
   * chord web inside the aspect circle. Distinct from `CrossRingAspects`,
   * which connects two different rings; omit for rings that shouldn't show
   * their own aspect web (typically anything but the base ring).
   */
  readonly aspects?: readonly Aspect[];
}

/**
 * One #51 `contacts` list, positioned between two of the `rings` passed to
 * `renderMultiWheelSvg`. `outerRingIndex`'s bodies must resolve `aspect.bodyA`
 * and `innerRingIndex`'s must resolve `aspect.bodyB` — exactly how every
 * domain module's `contacts` field is already ordered (moving/outer side
 * first), so a return or progression chart's `contacts` can be passed here
 * directly.
 */
export interface CrossRingAspects {
  readonly innerRingIndex: number;
  readonly outerRingIndex: number;
  readonly aspects: readonly Aspect[];
}

export interface MultiWheelOptions extends WheelOrientationOptions {
  /** The wheel is drawn in a `size` x `size` box; every radius scales with it. */
  readonly size?: number;
  /** How each ring's house-cusp spokes are drawn. Defaults to `equal-degree`. */
  readonly houseWedgeStyle?: HouseWedgeStyle;
  /** Cosmetic fill for the zodiac ring's twelve sign wedges. Defaults to `default` (no fill). */
  readonly signWedgeStyle?: SignWedgeStyle;
  /** Minimum longitude gap kept between adjacent glyphs within a ring. Defaults to 7° for one ring, 6° for more. */
  readonly minSeparationDeg?: number;
  /** Omits the `<svg>` wrapper, for embedding in a larger sheet. */
  readonly bare?: boolean;
}

const DEFAULT_SIZE = 800;
const DEFAULT_HOUSE_WEDGE_STYLE: HouseWedgeStyle = 'equal-degree';
const DEFAULT_SIGN_WEDGE_STYLE: SignWedgeStyle = 'default';
/** A single ring's radial stack (degree, sign, minutes) needs a little more room per body than a bare glyph. */
const DEFAULT_MIN_SEPARATION_SINGLE_DEG = 7;
const DEFAULT_MIN_SEPARATION_STACKED_DEG = 6;
/** Degree step the rainbow wedge's arc edges are approximated with (a straight-edged polygon, per this module's `polygon` primitive). */
const WEDGE_ARC_STEP_DEG = 3;
/** Average advance width of a digit/label character, in ems — a pure renderer has no text metrics. */
const CHAR_EMS = 0.62;

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** Where a cusp is actually drawn, under the given house-wedge style. */
function cuspDisplayLongitude(cuspLongitude: Degrees, style: HouseWedgeStyle): Degrees {
  if (style === 'equal-degree') return cuspLongitude;
  return Math.floor(norm360(cuspLongitude) / 30) * 30;
}

/** A longitude's degree and minute within its sign, rounded to the minute. */
function degreeMinute(longitude: Degrees): { readonly degree: number; readonly minute: number } {
  const totalMinutes = Math.round(degreesInSign(longitude) * 60);
  return { degree: Math.floor(totalMinutes / 60) % 30, minute: totalMinutes % 60 };
}

/** The angle, in degrees of arc, that half a `chars`-character label plus a small gap subtends at `radius`. */
function halfLabelArcDeg(chars: number, fontSize: number, radius: number): number {
  const halfWidth = (chars * CHAR_EMS * fontSize) / 2 + fontSize * 0.3;
  return (halfWidth / radius) * (180 / Math.PI);
}

function signElementClass(signIndex: number): string {
  const sign = SIGNS[signIndex];
  return sign === undefined ? '' : ` chart-sign-element-${sign.element}`;
}

/**
 * One sign's wedge in the zodiac ring, as a straight-edged polygon tracing
 * the outer arc then back along the inner arc — an approximation good enough
 * at any sheet size given how fine `WEDGE_ARC_STEP_DEG` is, and it reuses
 * `wheelAngle`/`pointOnCircle` exactly like every tick and glyph here, so it
 * can never drift out of alignment with them under any orientation or sweep.
 */
function signWedgePolygon(
  geometry: SheetGeometry,
  ascendant: Degrees,
  orientationOptions: WheelOrientationOptions,
  signIndex: number,
): string {
  const { cx, cy, zodiacOuter, zodiacInner } = geometry;
  const start = signIndex * 30;
  const steps: number[] = [];
  for (let degree = start; degree < start + 30; degree += WEDGE_ARC_STEP_DEG) steps.push(degree);
  steps.push(start + 30);

  const outerPoints = steps.map((degree) =>
    pointOnCircle(cx, cy, zodiacOuter, wheelAngle(degree, ascendant, orientationOptions)),
  );
  const innerPoints = steps
    .map((degree) => pointOnCircle(cx, cy, zodiacInner, wheelAngle(degree, ascendant, orientationOptions)))
    .reverse();
  const sign = SIGNS[signIndex];
  const signName = sign === undefined ? String(signIndex) : sign.name.toLowerCase();
  return polygon([...outerPoints, ...innerPoints], `wheel-sign-wedge wheel-sign-wedge-${signName}`);
}

/**
 * The zodiac dial and the degree ruler under it: the dial's two edges (the inner one
 * filled, tinting everything inside it), an optional rainbow sign-wedge fill, sign
 * boundaries spanning the dial, the twelve element-coloured sign glyphs, and three tiers
 * of degree ticks hanging inward from the dial's inner edge.
 *
 * Each sign glyph is its own clickable `<g data-sign>` with an invisible hit area (#412).
 */
function renderZodiacRingSvg(
  geometry: SheetGeometry,
  ascendant: Degrees,
  orientationOptions: WheelOrientationOptions,
  signWedgeStyle: SignWedgeStyle = 'default',
): string {
  const { cx, cy, zodiacOuter, zodiacInner } = geometry;
  const parts: string[] = [circle(cx, cy, zodiacOuter, 'wheel-ring-outer')];
  if (signWedgeStyle === 'rainbow') {
    for (let signIndex = 0; signIndex < SIGNS.length; signIndex++) {
      parts.push(signWedgePolygon(geometry, ascendant, orientationOptions, signIndex));
    }
  }
  parts.push(circle(cx, cy, zodiacInner, 'wheel-ring-inner'));

  for (let degree = 0; degree < 360; degree += 1) {
    const angle = wheelAngle(degree, ascendant, orientationOptions);
    if (degree % 30 === 0) {
      const outer = pointOnCircle(cx, cy, zodiacOuter, angle);
      const inner = pointOnCircle(cx, cy, zodiacInner, angle);
      parts.push(line(outer.x, outer.y, inner.x, inner.y, 'wheel-sign-boundary'));
    }
    const isMajor = degree % TICK_MAJOR_INTERVAL_DEG === 0;
    const isMedium = degree % TICK_MEDIUM_INTERVAL_DEG === 0;
    const length = isMajor ? geometry.tickMajorLength : isMedium ? geometry.tickMediumLength : geometry.tickMinorLength;
    const tickClass = isMajor ? 'wheel-tick-major' : isMedium ? 'wheel-tick-medium' : 'wheel-tick-minor';
    const outer = pointOnCircle(cx, cy, zodiacInner, angle);
    const inner = pointOnCircle(cx, cy, zodiacInner - length, angle);
    parts.push(line(outer.x, outer.y, inner.x, inner.y, tickClass));
  }

  for (const sign of SIGNS) {
    const definition = signGlyph(sign.name);
    if (!definition) continue;
    const name = sign.name.toLowerCase();
    // Centred in the sign's own 30° arc.
    const angle = wheelAngle(sign.index * 30 + 15, ascendant, orientationOptions);
    const point = pointOnCircle(cx, cy, geometry.signGlyphRadius, angle);
    parts.push(
      `<g class="chart-sign" data-sign="${name}">` +
        hitAreaCircle(point.x, point.y, geometry.signGlyphSize * 0.62) +
        renderGlyph(
          definition,
          point.x,
          point.y,
          geometry.signGlyphSize,
          `chart-sign-glyph chart-sign-glyph-${name}${signElementClass(sign.index)}`,
        ) +
        `</g>`,
    );
  }

  return parts.join('');
}

/**
 * The base chart's house structure: the house dial (`aspectCircle`-`houseRing`) with its
 * numbers 1-12, a thin spoke per cusp from the dial out to the ruler, and the four angles
 * drawn heavy from the dial out to the zodiac dial's outer edge — labelled ASC/DSC/MC/IC
 * inside the house dial and with their exact degree in the zodiac dial (#412). The axes
 * deliberately stop at the aspect circle rather than crossing the aspect web.
 *
 * The axes are drawn from the `HousePositions` angles themselves rather than
 * from cusps 1 and 10, so they stay the true horizon and meridian even under
 * `whole-sign`, where the drawn cusp is rounded back to its sign boundary and
 * genuinely is not the angle.
 */
function renderBaseHousesSvg(
  houses: HousePositions,
  geometry: SheetGeometry,
  ascendant: Degrees,
  houseWedgeStyle: HouseWedgeStyle,
  orientationOptions: WheelOrientationOptions,
): string {
  const { cx, cy, zodiacInner, zodiacOuter, aspectCircle } = geometry;
  const parts: string[] = [circle(cx, cy, geometry.houseRing, 'wheel-ring-house')];

  for (let house = 1; house <= 12; house += 1) {
    const cuspLongitude = houses.cusps[house];
    if (cuspLongitude === undefined) continue;
    const angle = wheelAngle(cuspDisplayLongitude(cuspLongitude, houseWedgeStyle), ascendant, orientationOptions);
    const outer = pointOnCircle(cx, cy, zodiacInner, angle);
    const inner = pointOnCircle(cx, cy, aspectCircle, angle);
    const isAngular = ANGULAR_HOUSES.includes(house);
    parts.push(
      line(
        outer.x,
        outer.y,
        inner.x,
        inner.y,
        `chart-multiwheel-cusp${isAngular ? ' chart-multiwheel-cusp-angle' : ''}`,
      ),
    );
  }

  const axes = [
    { label: 'ASC', longitude: houses.ascendant },
    { label: 'DSC', longitude: houses.ascendant + 180 },
    { label: 'MC', longitude: houses.midheaven },
    { label: 'IC', longitude: houses.midheaven + 180 },
  ];
  const degreeRadius = zodiacOuter - geometry.axisDegreeFontSize * 0.85;
  for (const axis of axes) {
    const angle = wheelAngle(axis.longitude, ascendant, orientationOptions);
    const from = pointOnCircle(cx, cy, aspectCircle, angle);
    const to = pointOnCircle(cx, cy, zodiacOuter, angle);
    parts.push(line(from.x, from.y, to.x, to.y, 'chart-multiwheel-axis'));

    // Just before the angle, on the side of the house it closes (12th for ASC, 9th for MC…),
    // leaving the angle's own house free for its number.
    const labelOffset = halfLabelArcDeg(axis.label.length, geometry.axisLabelFontSize, geometry.houseNumberRadius);
    const labelPoint = pointOnCircle(
      cx,
      cy,
      geometry.houseNumberRadius,
      wheelAngle(axis.longitude - labelOffset, ascendant, orientationOptions),
    );
    parts.push(
      text(
        labelPoint.x,
        labelPoint.y + baselineOffset(geometry.axisLabelFontSize),
        'middle',
        'chart-axis-label',
        axis.label,
        geometry.axisLabelFontSize,
      ),
    );

    // Degree on one side of the line, minutes on the other, as the reference wheel prints it.
    const { degree, minute } = degreeMinute(norm360(axis.longitude));
    const degreeText = `${String(degree)}°`;
    const minuteText = `${String(minute).padStart(2, '0')}'`;
    const fontSize = geometry.axisDegreeFontSize;
    const degreePoint = pointOnCircle(
      cx,
      cy,
      degreeRadius,
      wheelAngle(
        axis.longitude + halfLabelArcDeg(degreeText.length, fontSize, degreeRadius),
        ascendant,
        orientationOptions,
      ),
    );
    const minutePoint = pointOnCircle(
      cx,
      cy,
      degreeRadius,
      wheelAngle(
        axis.longitude - halfLabelArcDeg(minuteText.length, fontSize, degreeRadius),
        ascendant,
        orientationOptions,
      ),
    );
    parts.push(
      text(
        degreePoint.x,
        degreePoint.y + baselineOffset(fontSize),
        'middle',
        'chart-axis-degree',
        degreeText,
        fontSize,
      ),
      text(
        minutePoint.x,
        minutePoint.y + baselineOffset(fontSize),
        'middle',
        'chart-axis-degree',
        minuteText,
        fontSize,
      ),
    );
  }

  for (let house = 1; house <= 12; house += 1) {
    const start = houses.cusps[house];
    const end = houses.cusps[house === 12 ? 1 : house + 1];
    if (start === undefined || end === undefined) continue;
    const startDisplay = cuspDisplayLongitude(start, houseWedgeStyle);
    const endDisplay = cuspDisplayLongitude(end, houseWedgeStyle);
    const midLongitude = startDisplay + norm360(endDisplay - startDisplay) / 2;
    const angle = wheelAngle(midLongitude, ascendant, orientationOptions);
    const point = pointOnCircle(cx, cy, geometry.houseNumberRadius, angle);
    parts.push(
      text(
        point.x,
        point.y + baselineOffset(geometry.houseNumberFontSize),
        'middle',
        'chart-house-number',
        String(house),
        geometry.houseNumberFontSize,
      ),
    );
  }

  return parts.join('');
}

/** A non-base ring's own cusps, confined to its band so they don't collide with the base chart's spokes. */
function renderRingCuspsSvg(
  houses: HousePositions,
  ascendant: Degrees,
  geometry: SheetGeometry,
  band: RingBand,
  ringIndex: number,
  houseWedgeStyle: HouseWedgeStyle,
  orientationOptions: WheelOrientationOptions,
): string {
  const { cx, cy } = geometry;
  const ringClass = `chart-multiwheel-ring chart-multiwheel-ring-${String(ringIndex)}`;
  const parts: string[] = [circle(cx, cy, band.innerRadius, ringClass)];

  for (let house = 1; house <= 12; house += 1) {
    const cuspLongitude = houses.cusps[house];
    if (cuspLongitude === undefined) continue;
    const angle = wheelAngle(cuspDisplayLongitude(cuspLongitude, houseWedgeStyle), ascendant, orientationOptions);
    const isAngular = ANGULAR_HOUSES.includes(house);
    const stubOuter = band.innerRadius + (band.outerRadius - band.innerRadius) * 0.4;
    const outerEnd = pointOnCircle(cx, cy, isAngular ? band.outerRadius : stubOuter, angle);
    const innerEnd = pointOnCircle(cx, cy, band.innerRadius, angle);
    parts.push(
      line(
        outerEnd.x,
        outerEnd.y,
        innerEnd.x,
        innerEnd.y,
        `chart-multiwheel-cusp chart-multiwheel-ring-${String(ringIndex)}${isAngular ? ' chart-multiwheel-cusp-angle' : ''}`,
      ),
    );
  }

  return parts.join('');
}

/** A short tick at each body's true degree on its band's inner edge — the house dial's outer edge for the base ring. */
function renderBodyTicksSvg(
  positions: readonly GlyphLayoutInput[],
  geometry: SheetGeometry,
  ascendant: Degrees,
  band: RingBand,
  orientationOptions: WheelOrientationOptions,
  ring: number,
): string {
  return positions
    .map((position) => {
      const angle = wheelAngle(position.longitude, ascendant, orientationOptions);
      const inner = pointOnCircle(geometry.cx, geometry.cy, band.innerRadius, angle);
      const outer = pointOnCircle(geometry.cx, geometry.cy, band.innerRadius + geometry.bodyTickLength, angle);
      return `<line x1="${fmt(inner.x)}" y1="${fmt(inner.y)}" x2="${fmt(outer.x)}" y2="${fmt(outer.y)}" class="chart-body-tick" ${bodyAttributes(position.key, position.longitude, ring)} />`;
    })
    .join('');
}

/**
 * The rest of each body's radial stack, under its glyph: degree, sign glyph (in its
 * element colour) and minutes, all at the *spread* angle the glyph was drawn at, so a
 * nudged glyph keeps its whole stack lined up beneath it (#412). Every part carries the
 * body's `data-body`, so clicking any of it isolates that body and dimming reaches it.
 *
 * `spreadGlyphs` is recomputed rather than threaded out of `renderGlyphRingSvg` — it is
 * pure and deterministic, so both calls agree.
 */
function renderBodyStacksSvg(
  positions: readonly GlyphLayoutInput[],
  geometry: SheetGeometry,
  ascendant: Degrees,
  band: RingBand,
  minSeparationDeg: number,
  orientationOptions: WheelOrientationOptions,
  ring: number,
): string {
  const { cx, cy } = geometry;
  const parts: string[] = [];
  for (const placement of spreadGlyphs(positions, minSeparationDeg)) {
    const angle = wheelAngle(placement.displayLongitude, ascendant, orientationOptions);
    const { degree, minute } = degreeMinute(placement.longitude);
    const signIndex = Math.floor(norm360(placement.longitude) / 30);
    const sign = SIGNS[signIndex];
    const signDefinition = sign === undefined ? undefined : signGlyph(sign.name);

    const degreePoint = pointOnCircle(cx, cy, band.degreeLabelRadius, angle);
    const signPoint = pointOnCircle(cx, cy, band.signLabelRadius, angle);
    const minutePoint = pointOnCircle(cx, cy, band.minuteLabelRadius, angle);
    const stack: string[] = [
      text(
        degreePoint.x,
        degreePoint.y + baselineOffset(geometry.degreeFontSize),
        'middle',
        'chart-degree-label',
        `${String(degree)}°`,
        geometry.degreeFontSize,
      ),
    ];
    if (sign !== undefined && signDefinition !== undefined) {
      stack.push(
        renderGlyph(
          signDefinition,
          signPoint.x,
          signPoint.y,
          geometry.stackSignGlyphSize,
          `chart-sign-glyph chart-stack-sign-glyph chart-sign-glyph-${sign.name.toLowerCase()}${signElementClass(signIndex)}`,
        ),
      );
    }
    stack.push(
      text(
        minutePoint.x,
        minutePoint.y + baselineOffset(geometry.minuteFontSize),
        'middle',
        'chart-minute-label',
        `${String(minute).padStart(2, '0')}'`,
        geometry.minuteFontSize,
      ),
    );
    parts.push(
      `<g class="chart-body-stack" ${bodyAttributes(placement.key, placement.longitude, ring)}>${stack.join('')}</g>`,
    );
  }
  return parts.join('');
}

/**
 * Renders one to three chart rings as one SVG document around a shared center.
 * `rings` is ordered innermost first — by convention the base/natal chart at
 * index 0 — since that ring's Ascendant is what every ring, including the
 * shared zodiac ring, is oriented by, and its houses are the ones the numeric
 * house labels and full-length cusp spokes describe.
 */
export function renderMultiWheelSvg(
  rings: readonly WheelRingInput[],
  crossAspects: readonly CrossRingAspects[] = [],
  options?: MultiWheelOptions,
): string {
  const [baseRing] = rings;
  if (baseRing === undefined) throw new Error('renderMultiWheelSvg requires at least one ring');

  const size = options?.size ?? DEFAULT_SIZE;
  const houseWedgeStyle = options?.houseWedgeStyle ?? DEFAULT_HOUSE_WEDGE_STYLE;
  const signWedgeStyle = options?.signWedgeStyle ?? DEFAULT_SIGN_WEDGE_STYLE;
  const minSeparationDeg =
    options?.minSeparationDeg ??
    (rings.length === 1 ? DEFAULT_MIN_SEPARATION_SINGLE_DEG : DEFAULT_MIN_SEPARATION_STACKED_DEG);
  const bare = options?.bare ?? false;
  const orientationOptions: WheelOrientationOptions = {
    ...(options?.orientation !== undefined ? { orientation: options.orientation } : {}),
    ...(options?.sweep !== undefined ? { sweep: options.sweep } : {}),
  };

  const geometry = resolveSheetGeometry(size);
  const { cx, cy } = geometry;
  const ascendant = baseRing.houses.ascendant;
  const bands = resolveRingBands(geometry, rings.length);

  const parts: string[] = [renderZodiacRingSvg(geometry, ascendant, orientationOptions, signWedgeStyle)];
  parts.push(renderBaseHousesSvg(baseRing.houses, geometry, ascendant, houseWedgeStyle, orientationOptions));
  parts.push(circle(cx, cy, geometry.aspectCircle, 'wheel-ring-aspect'));

  rings.forEach((ring, index) => {
    const band = bands[index];
    if (band === undefined) throw new Error('unreachable: resolveRingBands returns one band per ring');
    if (index > 0) {
      parts.push(
        renderRingCuspsSvg(ring.houses, ascendant, geometry, band, index, houseWedgeStyle, orientationOptions),
      );
    }
    const glyphInputs: readonly GlyphLayoutInput[] = ring.bodies.map((b) => ({
      key: b.key,
      longitude: b.longitude,
      ...(b.retrograde === true ? { retrograde: true } : {}),
    }));
    parts.push(renderBodyTicksSvg(glyphInputs, geometry, ascendant, band, orientationOptions, index));
    // Only a single ring's band is wide enough for the radial degree/sign/minute stack;
    // with two or three charts stacked, it would overlap the neighbouring ring's glyphs.
    if (rings.length === 1) {
      parts.push(
        renderBodyStacksSvg(glyphInputs, geometry, ascendant, band, minSeparationDeg, orientationOptions, index),
      );
    }
    parts.push(
      renderGlyphRingSvg(glyphInputs, ascendant, cx, cy, band.glyphRadius, band.trueRadius, {
        ...orientationOptions,
        minSeparationDeg,
        glyphSize: geometry.bodyGlyphSize,
        leaderEndRadius: Math.min(band.glyphRadius + geometry.bodyGlyphSize / 2, band.trueRadius),
        retrogradeFontSize: geometry.retrogradeFontSize,
        ring: index,
      }),
    );
    if (ring.aspects !== undefined && ring.aspects.length > 0) {
      const longitudeByBody = new Map(ring.bodies.map((b) => [b.body, b.longitude]));
      const longitudeOf = (body: BodyId): Degrees => {
        const longitude = longitudeByBody.get(body);
        if (longitude === undefined) {
          throw new Error(`renderMultiWheelSvg: aspect body ${String(body)} is not present in ring ${String(index)}`);
        }
        return longitude;
      };
      const chords = ring.aspects.filter((aspect) => aspect.aspect.key !== 'conjunction');
      parts.push(
        renderAspectWebSvg(chords, longitudeOf, ascendant, cx, cy, geometry.aspectCircle, orientationOptions, index),
      );
    }
  });

  for (const cross of crossAspects) {
    const outerRing = rings[cross.outerRingIndex];
    const innerRing = rings[cross.innerRingIndex];
    const outerBand = bands[cross.outerRingIndex];
    const innerBand = bands[cross.innerRingIndex];
    if (!outerRing || !innerRing || !outerBand || !innerBand) {
      throw new Error('renderMultiWheelSvg: crossAspects references a ring index out of range');
    }
    const longitudeByBodyA = new Map(outerRing.bodies.map((b) => [b.body, b.longitude]));
    const longitudeByBodyB = new Map(innerRing.bodies.map((b) => [b.body, b.longitude]));
    const resolveA = (body: BodyId): { longitude: Degrees; radius: number; ring: number } => {
      const longitude = longitudeByBodyA.get(body);
      if (longitude === undefined) {
        throw new Error(
          `renderMultiWheelSvg: body ${String(body)} is not present in outer ring ${String(cross.outerRingIndex)}`,
        );
      }
      return { longitude, radius: geometry.aspectCircle, ring: cross.outerRingIndex };
    };
    const resolveB = (body: BodyId): { longitude: Degrees; radius: number; ring: number } => {
      const longitude = longitudeByBodyB.get(body);
      if (longitude === undefined) {
        throw new Error(
          `renderMultiWheelSvg: body ${String(body)} is not present in inner ring ${String(cross.innerRingIndex)}`,
        );
      }
      return { longitude, radius: geometry.aspectCircle, ring: cross.innerRingIndex };
    };
    parts.push(renderCrossRingAspectWebSvg(cross.aspects, resolveA, resolveB, ascendant, cx, cy, orientationOptions));
  }

  // Fixed corner legend, not radial text (see this module's doc comment).
  // Pointless for a single ring, which has nothing to tell apart.
  if (rings.length > 1) {
    rings.forEach((ring, index) => {
      const x = -geometry.labelMargin + geometry.panelFontSize * 0.5;
      const y = -geometry.labelMargin + geometry.panelFontSize * (1 + index * 1.3);
      parts.push(
        circle(
          x + geometry.panelFontSize * 0.3,
          y - geometry.panelFontSize * 0.3,
          geometry.panelFontSize * 0.3,
          `chart-multiwheel-legend-swatch chart-multiwheel-ring-${String(index)}`,
        ),
      );
      parts.push(
        text(
          x + geometry.panelFontSize,
          y,
          'start',
          'chart-multiwheel-legend-label',
          escapeXml(ring.label),
          geometry.panelFontSize,
        ),
      );
    });
  }

  const body = parts.join('');
  if (bare) return body;

  const viewBoxOrigin = -geometry.labelMargin;
  const viewBoxSize = size + geometry.labelMargin * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(viewBoxOrigin)} ${fmt(viewBoxOrigin)} ${fmt(viewBoxSize)} ${fmt(viewBoxSize)}" ` +
    `width="${String(size)}" height="${String(size)}" class="chart-multiwheel">` +
    `${body}</svg>`
  );
}
