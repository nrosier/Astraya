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
 * Aspect chords are confined to the inner disk (r <= the aspect circle) so
 * they never cross the bands carrying glyphs. Conjunctions are excluded from
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
import { renderGlyphRingSvg, spreadGlyphs } from './glyph-layout.js';
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
  readonly bodies: readonly { readonly body: BodyId; readonly key: string; readonly longitude: Degrees }[];
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
  /** Minimum longitude gap kept between adjacent glyphs within a ring. Defaults to 6°. */
  readonly minSeparationDeg?: number;
  /** Omits the outer border, zodiac ring and corner legend, for embedding in a larger sheet. */
  readonly bare?: boolean;
}

const DEFAULT_SIZE = 800;
const DEFAULT_HOUSE_WEDGE_STYLE: HouseWedgeStyle = 'equal-degree';
const DEFAULT_SIGN_WEDGE_STYLE: SignWedgeStyle = 'default';
const DEFAULT_MIN_SEPARATION_DEG = 6;
/** Degree step the rainbow wedge's arc edges are approximated with (a straight-edged polygon, per this module's `polygon` primitive). */
const WEDGE_ARC_STEP_DEG = 3;

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** Where a cusp is actually drawn, under the given house-wedge style. */
function cuspDisplayLongitude(cuspLongitude: Degrees, style: HouseWedgeStyle): Degrees {
  if (style === 'equal-degree') return cuspLongitude;
  return Math.floor(norm360(cuspLongitude) / 30) * 30;
}

/** `05°12'` — a body's degree and minute within its sign, zero-padded to a fixed width so a column of them aligns. */
function formatDegreeMinute(longitude: Degrees): string {
  const withinSign = degreesInSign(longitude);
  const totalMinutes = Math.round(withinSign * 60);
  const degree = Math.floor(totalMinutes / 60) % 30;
  const minute = totalMinutes % 60;
  return `${String(degree).padStart(2, '0')}°${String(minute).padStart(2, '0')}'`;
}

/**
 * How wide `05°12'` draws, including the gap that keeps two of them apart.
 * Stated in ems because a pure renderer has no text metrics to measure with, and
 * an em figure scales with the sheet exactly as the drawn text does.
 */
const DEGREE_LABEL_EMS = 3.6;

function labelWidth(fontSize: number): number {
  return fontSize * DEGREE_LABEL_EMS;
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

/** The zodiac ring: its two edges, an optional rainbow sign-wedge fill, three tiers of degree ticks, sign divisions and the twelve sign glyphs. */
function renderZodiacRingSvg(
  geometry: SheetGeometry,
  ascendant: Degrees,
  orientationOptions: WheelOrientationOptions,
  signWedgeStyle: SignWedgeStyle = 'default',
): string {
  const { cx, cy, zodiacOuter, zodiacInner } = geometry;
  const parts: string[] = [circle(cx, cy, geometry.outerBorder, 'wheel-ring-outer')];
  if (signWedgeStyle === 'rainbow') {
    for (let signIndex = 0; signIndex < SIGNS.length; signIndex++) {
      parts.push(signWedgePolygon(geometry, ascendant, orientationOptions, signIndex));
    }
  }
  parts.push(circle(cx, cy, zodiacOuter, 'wheel-ring-zodiac'));
  parts.push(circle(cx, cy, zodiacInner, 'wheel-ring-inner'));

  for (let degree = 0; degree < 360; degree += 1) {
    const angle = wheelAngle(degree, ascendant, orientationOptions);
    if (degree % 30 === 0) {
      // A sign division spans the whole ring, so it replaces the tick here.
      const outer = pointOnCircle(cx, cy, zodiacOuter, angle);
      const inner = pointOnCircle(cx, cy, zodiacInner, angle);
      parts.push(line(outer.x, outer.y, inner.x, inner.y, 'wheel-sign-boundary'));
      continue;
    }
    const isMajor = degree % TICK_MAJOR_INTERVAL_DEG === 0;
    const isMedium = degree % TICK_MEDIUM_INTERVAL_DEG === 0;
    const length = isMajor ? geometry.tickMajorLength : isMedium ? geometry.tickMediumLength : geometry.tickMinorLength;
    const tickClass = isMajor ? 'wheel-tick-major' : isMedium ? 'wheel-tick-medium' : 'wheel-tick-minor';
    const outer = pointOnCircle(cx, cy, zodiacInner + length, angle);
    const inner = pointOnCircle(cx, cy, zodiacInner, angle);
    parts.push(line(outer.x, outer.y, inner.x, inner.y, tickClass));
  }

  for (const sign of SIGNS) {
    const definition = signGlyph(sign.name);
    if (!definition) continue;
    // Centred in the sign's own 30° arc.
    const angle = wheelAngle(sign.index * 30 + 15, ascendant, orientationOptions);
    const point = pointOnCircle(cx, cy, geometry.signGlyphRadius, angle);
    parts.push(
      renderGlyph(
        definition,
        point.x,
        point.y,
        geometry.signGlyphSize,
        `chart-sign-glyph chart-sign-glyph-${sign.name.toLowerCase()}`,
      ),
    );
  }

  return parts.join('');
}

/**
 * The base chart's house structure: a spoke per cusp reaching the zodiac ring,
 * the ASC-DSC and MC-IC axes drawn heavy across the whole chart, and the
 * numeric house labels 1-12.
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
  innerRadius: number,
  houseWedgeStyle: HouseWedgeStyle,
  orientationOptions: WheelOrientationOptions,
): string {
  const { cx, cy, zodiacInner } = geometry;
  const parts: string[] = [];

  for (let house = 1; house <= 12; house += 1) {
    const cuspLongitude = houses.cusps[house];
    if (cuspLongitude === undefined) continue;
    const angle = wheelAngle(cuspDisplayLongitude(cuspLongitude, houseWedgeStyle), ascendant, orientationOptions);
    const outer = pointOnCircle(cx, cy, zodiacInner, angle);
    const inner = pointOnCircle(cx, cy, innerRadius, angle);
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

  for (const axis of [houses.ascendant, houses.midheaven]) {
    const angle = wheelAngle(axis, ascendant, orientationOptions);
    const from = pointOnCircle(cx, cy, zodiacInner, angle);
    const to = pointOnCircle(cx, cy, zodiacInner, angle + 180);
    parts.push(line(from.x, from.y, to.x, to.y, 'chart-multiwheel-axis'));
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
  const parts: string[] = [circle(cx, cy, band.outerRadius, ringClass)];

  for (let house = 1; house <= 12; house += 1) {
    const cuspLongitude = houses.cusps[house];
    if (cuspLongitude === undefined) continue;
    const angle = wheelAngle(cuspDisplayLongitude(cuspLongitude, houseWedgeStyle), ascendant, orientationOptions);
    const isAngular = ANGULAR_HOUSES.includes(house);
    const stubOuter = band.innerRadius + (band.outerRadius - band.innerRadius) * 0.6;
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

/**
 * The `05°12'` annotation beside each body, at the *spread* angle its glyph
 * was actually drawn at rather than its true degree, so the label tracks a
 * glyph the collision pass nudged.
 *
 * The sign is deliberately not repeated here as a glyph: the body sits on a
 * radial line straight out to its own sign's glyph in the zodiac ring, and a
 * third element per body in a band this narrow is what makes a crowded chart
 * illegible. `spreadGlyphs` is recomputed rather than threaded out of
 * `renderGlyphRingSvg` — it is pure and deterministic, so both calls agree,
 * and the alternative is teaching the glyph ring about degree formatting.
 */
function renderDegreeLabelsSvg(
  positions: readonly GlyphLayoutInput[],
  geometry: SheetGeometry,
  ascendant: Degrees,
  band: RingBand,
  minSeparationDeg: number,
  orientationOptions: WheelOrientationOptions,
): string {
  const placements = [...spreadGlyphs(positions, minSeparationDeg)].sort(
    (a, b) => a.displayLongitude - b.displayLongitude,
  );
  // A label is far wider than the glyph it annotates, so the separation that
  // keeps glyphs apart is nowhere near enough to keep labels apart. Widening the
  // spread until they all fit would space 20 bodies almost evenly around the
  // ring and destroy the clustering the wheel exists to show, so the labels a
  // cluster has no room for are dropped instead: the glyph and its leader line
  // still carry the position, and the exact degree is in the Positions table.
  // The threshold is an angle, not a pixel count, so it holds at every `size`.
  const labelWidthDeg = (labelWidth(geometry.degreeFontSize) / (2 * Math.PI * band.degreeLabelRadius)) * 360;
  const parts: string[] = [];
  let lastShown: number | undefined;
  let firstShown: number | undefined;
  for (const placement of placements) {
    if (lastShown !== undefined && placement.displayLongitude - lastShown < labelWidthDeg) continue;
    if (firstShown !== undefined && norm360(firstShown - placement.displayLongitude) < labelWidthDeg) continue;
    lastShown = placement.displayLongitude;
    firstShown ??= placement.displayLongitude;
    const angle = wheelAngle(placement.displayLongitude, ascendant, orientationOptions);
    const point = pointOnCircle(geometry.cx, geometry.cy, band.degreeLabelRadius, angle);
    parts.push(
      text(
        point.x,
        point.y + baselineOffset(geometry.degreeFontSize),
        'middle',
        'chart-degree-label',
        formatDegreeMinute(placement.longitude),
        geometry.degreeFontSize,
      ),
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
  const minSeparationDeg = options?.minSeparationDeg ?? DEFAULT_MIN_SEPARATION_DEG;
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
  parts.push(circle(cx, cy, geometry.aspectCircle, 'wheel-ring-aspect'));

  const baseBand = bands[0];
  if (baseBand === undefined) throw new Error('unreachable: resolveRingBands returns one band per ring');
  parts.push(
    renderBaseHousesSvg(
      baseRing.houses,
      geometry,
      ascendant,
      baseBand.innerRadius,
      houseWedgeStyle,
      orientationOptions,
    ),
  );

  rings.forEach((ring, index) => {
    const band = bands[index];
    if (band === undefined) throw new Error('unreachable: resolveRingBands returns one band per ring');
    if (index > 0) {
      parts.push(
        renderRingCuspsSvg(ring.houses, ascendant, geometry, band, index, houseWedgeStyle, orientationOptions),
      );
    }
    const glyphInputs: readonly GlyphLayoutInput[] = ring.bodies.map((b) => ({ key: b.key, longitude: b.longitude }));
    parts.push(
      renderGlyphRingSvg(glyphInputs, ascendant, cx, cy, band.glyphRadius, band.trueRadius, {
        ...orientationOptions,
        minSeparationDeg,
        glyphSize: geometry.bodyGlyphSize,
      }),
    );
    // Only a single ring's band is wide enough for a legible degree column;
    // with two or three charts stacked, the labels would overlap their glyphs.
    if (rings.length === 1) {
      parts.push(renderDegreeLabelsSvg(glyphInputs, geometry, ascendant, band, minSeparationDeg, orientationOptions));
    }
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
      parts.push(renderAspectWebSvg(chords, longitudeOf, ascendant, cx, cy, geometry.aspectCircle, orientationOptions));
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
    const resolveA = (body: BodyId): { longitude: Degrees; radius: number } => {
      const longitude = longitudeByBodyA.get(body);
      if (longitude === undefined) {
        throw new Error(
          `renderMultiWheelSvg: body ${String(body)} is not present in outer ring ${String(cross.outerRingIndex)}`,
        );
      }
      return { longitude, radius: outerBand.trueRadius };
    };
    const resolveB = (body: BodyId): { longitude: Degrees; radius: number } => {
      const longitude = longitudeByBodyB.get(body);
      if (longitude === undefined) {
        throw new Error(
          `renderMultiWheelSvg: body ${String(body)} is not present in inner ring ${String(cross.innerRingIndex)}`,
        );
      }
      return { longitude, radius: innerBand.trueRadius };
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
