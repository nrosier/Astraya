/**
 * Bi-wheel and tri-wheel renderer (#52): several charts drawn as concentric
 * rings around one shared center, so a progression, return or transit chart
 * can be read directly against whatever it's being compared to instead of
 * two separate wheels side by side.
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
 * A ring's glyphs go through `renderGlyphRingSvg` exactly as a single wheel's
 * do, so collision spreading (#40/#41) is reused per ring, unmodified, for
 * free — each ring spreads only its own bodies, at its own band's radii.
 *
 * Cross-ring aspect lines use `renderCrossRingAspectWebSvg` (`aspect-web.ts`,
 * this same issue's extension of #42) anchored to each ring's `trueRadius`
 * rather than wherever collision spreading placed a crowded glyph, for the
 * same reason a single wheel's own aspect web anchors to its inner circle
 * instead of the glyph ring.
 *
 * Ring labels are a fixed legend in the corner, not radial text: text drawn
 * at a wheel-space angle (as every other label here is) turns upside-down on
 * the far side of the circle as the chart rotates, and a legend sidesteps
 * that without needing to reserve one "safe" angle that's never crowded.
 */
import type { Aspect } from '../astrology/aspects.js';
import type { BodyId, Degrees, HousePositions } from '../ephemeris/types.js';
import { renderCrossRingAspectWebSvg } from './aspect-web.js';
import type { GlyphLayoutInput } from './glyph-layout.js';
import { renderGlyphRingSvg } from './glyph-layout.js';
import type { HouseWedgeStyle, WheelOrientationOptions } from './wheel.js';
import { pointOnCircle, wheelAngle } from './wheel.js';

/** The four angular houses, by the standard convention (1=ASC, 4=IC, 7=DC, 10=MC). */
const ANGULAR_HOUSES: readonly number[] = [1, 4, 7, 10];

/** One chart to draw as a ring, innermost ring first (index 0). */
export interface WheelRingInput {
  /** Shown in the corner legend, e.g. "Natal" or "Solar return 2026". */
  readonly label: string;
  readonly houses: HousePositions;
  readonly bodies: readonly { readonly body: BodyId; readonly key: string; readonly longitude: Degrees }[];
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
  /** SVG viewport is `size` x `size` pixels; the corner legend extends into `labelMargin`. */
  readonly size?: number;
  /** Extra space reserved outside the wheel for the ring legend, in pixels. */
  readonly labelMargin?: number;
  /** Spacing of minor degree ticks on the shared outer zodiac ring, in degrees. */
  readonly tickIntervalDeg?: number;
  /** Spacing of major degree ticks on the shared outer zodiac ring, in degrees. */
  readonly majorTickIntervalDeg?: number;
  /** How each ring's house-cusp spokes are drawn. Defaults to `equal-degree`. */
  readonly houseWedgeStyle?: HouseWedgeStyle;
  /** Minimum longitude gap kept between adjacent glyphs within a ring. Defaults to 6°. */
  readonly minSeparationDeg?: number;
  /** Glyph box size, in pixels. Defaults to 20 (smaller than a single wheel's, since bands are narrower). */
  readonly glyphSize?: number;
}

interface ResolvedOptions {
  readonly size: number;
  readonly labelMargin: number;
  readonly tickIntervalDeg: number;
  readonly majorTickIntervalDeg: number;
  readonly houseWedgeStyle: HouseWedgeStyle;
  readonly minSeparationDeg: number;
  readonly glyphSize: number;
  readonly orientationOptions: WheelOrientationOptions;
}

const DEFAULT_SIZE = 600;
const DEFAULT_HOUSE_WEDGE_STYLE: HouseWedgeStyle = 'equal-degree';
const DEFAULT_MIN_SEPARATION_DEG = 6;

function resolveOptions(options: MultiWheelOptions | undefined): ResolvedOptions {
  const size = options?.size ?? DEFAULT_SIZE;
  return {
    size,
    labelMargin: options?.labelMargin ?? size * 0.16,
    tickIntervalDeg: options?.tickIntervalDeg ?? 1,
    majorTickIntervalDeg: options?.majorTickIntervalDeg ?? 10,
    houseWedgeStyle: options?.houseWedgeStyle ?? DEFAULT_HOUSE_WEDGE_STYLE,
    minSeparationDeg: options?.minSeparationDeg ?? DEFAULT_MIN_SEPARATION_DEG,
    glyphSize: options?.glyphSize ?? 20,
    orientationOptions: {
      ...(options?.orientation !== undefined ? { orientation: options.orientation } : {}),
      ...(options?.sweep !== undefined ? { sweep: options.sweep } : {}),
    },
  };
}

interface RingBand {
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly glyphRadius: number;
  readonly trueRadius: number;
}

/** Divides the space between a small center hole and the shared zodiac ring into one equal band per ring, innermost first. */
function resolveBands(zodiacInnerRadius: number, ringCount: number): readonly RingBand[] {
  const centerHoleRadius = zodiacInnerRadius * 0.2;
  const bandWidth = (zodiacInnerRadius - centerHoleRadius) / ringCount;
  return Array.from({ length: ringCount }, (_, i) => {
    const innerRadius = centerHoleRadius + bandWidth * i;
    const outerRadius = innerRadius + bandWidth;
    return {
      innerRadius,
      outerRadius,
      trueRadius: innerRadius + bandWidth * 0.15,
      glyphRadius: innerRadius + bandWidth * 0.55,
    };
  });
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

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Where a cusp is actually drawn, under the given house-wedge style — same rule as `wheel.ts`. */
function cuspDisplayLongitude(cuspLongitude: Degrees, style: HouseWedgeStyle): Degrees {
  const normalized = ((cuspLongitude % 360) + 360) % 360;
  if (style === 'equal-degree') return cuspLongitude;
  return Math.floor(normalized / 30) * 30;
}

function renderRingCuspsSvg(
  houses: HousePositions,
  ascendant: Degrees,
  cx: number,
  cy: number,
  band: RingBand,
  ringIndex: number,
  houseWedgeStyle: HouseWedgeStyle,
  orientationOptions: WheelOrientationOptions,
): string {
  const parts: string[] = [];
  const ringClass = `chart-multiwheel-ring chart-multiwheel-ring-${String(ringIndex)}`;
  parts.push(circle(cx, cy, band.outerRadius, ringClass));

  for (let house = 1; house <= 12; house += 1) {
    const cuspLongitude = houses.cusps[house];
    if (cuspLongitude === undefined) continue;
    const displayLongitude = cuspDisplayLongitude(cuspLongitude, houseWedgeStyle);
    const angle = wheelAngle(displayLongitude, ascendant, orientationOptions);
    const isAngular = ANGULAR_HOUSES.includes(house);
    const stubOuter = band.innerRadius + (band.outerRadius - band.innerRadius) * 0.6;
    const outerEnd = pointOnCircle(cx, cy, isAngular ? band.outerRadius : stubOuter, angle);
    const innerEnd = pointOnCircle(cx, cy, band.innerRadius, angle);
    const cuspClass =
      `chart-multiwheel-cusp chart-multiwheel-ring-${String(ringIndex)} ${isAngular ? 'chart-multiwheel-cusp-angle' : ''}`.trim();
    parts.push(line(outerEnd.x, outerEnd.y, innerEnd.x, innerEnd.y, cuspClass));
  }

  return parts.join('');
}

function renderSharedZodiacRingSvg(
  ascendant: Degrees,
  cx: number,
  cy: number,
  outerRadius: number,
  zodiacInnerRadius: number,
  tickIntervalDeg: number,
  majorTickIntervalDeg: number,
  orientationOptions: WheelOrientationOptions,
): string {
  const parts: string[] = [];
  const zodiacRingWidth = outerRadius - zodiacInnerRadius;
  parts.push(circle(cx, cy, outerRadius, 'wheel-ring-outer'));
  parts.push(circle(cx, cy, zodiacInnerRadius, 'wheel-ring-inner'));

  for (let degree = 0; degree < 360; degree += tickIntervalDeg) {
    const angle = wheelAngle(degree, ascendant, orientationOptions);
    const isSignBoundary = degree % 30 === 0;
    const isMajorTick = degree % majorTickIntervalDeg === 0;
    if (isSignBoundary) {
      const outer = pointOnCircle(cx, cy, outerRadius, angle);
      const inner = pointOnCircle(cx, cy, zodiacInnerRadius, angle);
      parts.push(line(outer.x, outer.y, inner.x, inner.y, 'wheel-sign-boundary'));
      continue;
    }
    const tickLength = isMajorTick ? zodiacRingWidth * 0.35 : zodiacRingWidth * 0.15;
    const outer = pointOnCircle(cx, cy, zodiacInnerRadius + tickLength, angle);
    const inner = pointOnCircle(cx, cy, zodiacInnerRadius, angle);
    parts.push(line(outer.x, outer.y, inner.x, inner.y, isMajorTick ? 'wheel-tick-major' : 'wheel-tick-minor'));
  }

  return parts.join('');
}

/**
 * Renders 2 or more chart rings (a bi-wheel or tri-wheel) as one SVG document
 * around a shared center. `rings` is ordered innermost first — by convention
 * the base/natal chart at index 0 — since that ring's Ascendant is what every
 * ring, including the shared outer zodiac ring, is oriented by.
 */
export function renderMultiWheelSvg(
  rings: readonly WheelRingInput[],
  crossAspects: readonly CrossRingAspects[] = [],
  options?: MultiWheelOptions,
): string {
  const [baseRing] = rings;
  if (baseRing === undefined) throw new Error('renderMultiWheelSvg requires at least one ring');

  const {
    size,
    labelMargin,
    tickIntervalDeg,
    majorTickIntervalDeg,
    houseWedgeStyle,
    minSeparationDeg,
    glyphSize,
    orientationOptions,
  } = resolveOptions(options);
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = size / 2 - 2;
  const zodiacInnerRadius = outerRadius - size * 0.05;
  const ascendant = baseRing.houses.ascendant;
  const bands = resolveBands(zodiacInnerRadius, rings.length);

  const parts: string[] = [];
  parts.push(
    renderSharedZodiacRingSvg(
      ascendant,
      cx,
      cy,
      outerRadius,
      zodiacInnerRadius,
      tickIntervalDeg,
      majorTickIntervalDeg,
      orientationOptions,
    ),
  );

  rings.forEach((ring, index) => {
    const band = bands[index];
    if (band === undefined) throw new Error('unreachable: resolveBands returns one band per ring');
    parts.push(renderRingCuspsSvg(ring.houses, ascendant, cx, cy, band, index, houseWedgeStyle, orientationOptions));
    const glyphInputs: readonly GlyphLayoutInput[] = ring.bodies.map((b) => ({ key: b.key, longitude: b.longitude }));
    parts.push(
      renderGlyphRingSvg(glyphInputs, ascendant, cx, cy, band.glyphRadius, band.trueRadius, {
        ...orientationOptions,
        minSeparationDeg,
        glyphSize,
      }),
    );
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

  // Fixed corner legend, not radial text: a ring label drawn at a wheel-space
  // angle turns upside-down on the far side of the circle as the chart
  // rotates, so it can't double as a legible "which ring is which" key.
  rings.forEach((ring, index) => {
    const x = -labelMargin + 8;
    const y = -labelMargin + 16 + index * 16;
    parts.push(circle(x + 4, y - 4, 4, `chart-multiwheel-legend-swatch chart-multiwheel-ring-${String(index)}`));
    parts.push(text(x + 14, y, 'start', 'chart-multiwheel-legend-label', escapeXml(ring.label)));
  });

  const viewBoxOrigin = -labelMargin;
  const viewBoxSize = size + labelMargin * 2;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(viewBoxOrigin)} ${fmt(viewBoxOrigin)} ${fmt(viewBoxSize)} ${fmt(viewBoxSize)}" ` +
    `width="${String(size)}" height="${String(size)}" class="chart-multiwheel">` +
    `${parts.join('')}</svg>`
  );
}
