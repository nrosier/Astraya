/**
 * The 0-30 degree distribution strip.
 *
 * Every body's position within its own sign, on one shared axis. Sign is
 * dropped on purpose: what this panel is for is spotting that four bodies sit
 * near the same *degree* of different signs, which is invisible on the wheel
 * (they are 90 or 120 degrees apart there) and invisible in a positions table
 * (different sign names, so the numbers never line up in a column). Bodies at
 * the same degree of different signs are in aspect by definition, so a cluster
 * here is a cluster of exact aspects.
 *
 * Glyph spreading is linear, not the wheel's circular `spreadGlyphs`: this
 * domain is a bounded segment, so 29.5 and 0.5 are at opposite ends rather
 * than neighbours, and pushing a glyph past either end would put it outside
 * the axis it annotates. `spreadLinear` therefore clamps instead of wrapping.
 */
import { SIGN_SPAN, degreesInSign } from '../astrology/signs.js';
import type { Degrees } from '../ephemeris/types.js';
import { bodyGlyph, renderGlyph } from './glyphs.js';
import type { PanelLayout, PanelRender } from './sheet-geometry.js';
import { line, text } from './svg-primitives.js';

const MAX_RELAXATION_PASSES = 200;
const LABEL_INTERVAL_DEG = 5;

/**
 * Pushes values apart to at least `minSeparation`, staying inside
 * `[min, max]` and preserving both input order in the result and relative
 * order along the axis.
 *
 * Same relaxation idea as the wheel's `spreadGlyphs`, minus the circular
 * wrap-point handling that has no meaning here, plus a clamp at each end. When
 * the values cannot all fit — more bodies than `(max - min) / minSeparation`
 * slots — the clamp wins and some pairs stay closer than requested, which
 * degrades to a slightly crowded strip rather than glyphs drawn off the panel.
 */
export function spreadLinear(
  values: readonly number[],
  min: number,
  max: number,
  minSeparation: number,
): readonly number[] {
  if (values.length === 0) return [];
  const indexed = values.map((value, index) => ({ value, index }));
  const sorted = [...indexed].sort((a, b) => a.value - b.value || a.index - b.index);
  const positions = sorted.map((item) => item.value);

  for (let pass = 0; pass < MAX_RELAXATION_PASSES; pass += 1) {
    let moved = false;
    for (let i = 0; i < positions.length - 1; i += 1) {
      const a = positions[i];
      const b = positions[i + 1];
      if (a === undefined || b === undefined) continue;
      const deficit = minSeparation - (b - a);
      if (deficit > 1e-9) {
        positions[i] = a - deficit / 2;
        positions[i + 1] = b + deficit / 2;
        moved = true;
      }
    }
    for (let i = 0; i < positions.length; i += 1) {
      const value = positions[i];
      if (value === undefined) continue;
      positions[i] = Math.min(max, Math.max(min, value));
    }
    if (!moved) break;
  }

  const result = new Array<number>(values.length);
  sorted.forEach((item, sortedIndex) => {
    result[item.index] = positions[sortedIndex] ?? item.value;
  });
  return result;
}

export interface DegreeStripBody {
  /** A `bodyGlyph` key; a body without one is skipped. */
  readonly key: string;
  readonly longitude: Degrees;
}

export interface DegreeStripInput {
  readonly bodies: readonly DegreeStripBody[];
}

export function renderDegreeStripSvg(
  input: DegreeStripInput,
  layout: PanelLayout,
  fontSize: number,
  glyphSize: number,
): PanelRender {
  const axisY = layout.y + glyphSize * 1.4;
  const scale = layout.width / SIGN_SPAN;
  const xOf = (degree: number): number => layout.x + degree * scale;

  const parts: string[] = [line(layout.x, axisY, layout.x + layout.width, axisY, 'chart-strip-axis')];

  for (let degree = 0; degree <= SIGN_SPAN; degree += 1) {
    const labelled = degree % LABEL_INTERVAL_DEG === 0;
    const tickLength = labelled ? fontSize * 0.5 : fontSize * 0.25;
    const x = xOf(degree);
    parts.push(line(x, axisY, x, axisY + tickLength, labelled ? 'chart-strip-tick-major' : 'chart-strip-tick'));
    if (labelled) {
      parts.push(text(x, axisY + tickLength + fontSize, 'middle', 'chart-strip-label', `${String(degree)}°`, fontSize));
    }
  }

  const withGlyphs = input.bodies.filter((body) => bodyGlyph(body.key) !== undefined);
  const trueDegrees = withGlyphs.map((body) => degreesInSign(body.longitude));
  // Separation is expressed in axis degrees, derived from the glyph's own
  // width, so a wider glyph at export size still keeps its neighbour clear.
  const minSeparation = (glyphSize / scale) * 0.9;
  const displayDegrees = spreadLinear(trueDegrees, 0, SIGN_SPAN, minSeparation);

  withGlyphs.forEach((body, index) => {
    const definition = bodyGlyph(body.key);
    if (!definition) return;
    const trueDegree = trueDegrees[index];
    const displayDegree = displayDegrees[index];
    if (trueDegree === undefined || displayDegree === undefined) return;
    const glyphX = xOf(displayDegree);
    const glyphY = layout.y + glyphSize / 2;
    if (Math.abs(displayDegree - trueDegree) > 1e-9) {
      parts.push(line(xOf(trueDegree), axisY, glyphX, glyphY + glyphSize / 2, 'chart-glyph-leader'));
    }
    parts.push(renderGlyph(definition, glyphX, glyphY, glyphSize, `chart-glyph chart-glyph-${body.key}`));
  });

  const height = axisY - layout.y + fontSize * 0.5 + fontSize * 1.4;
  return { markup: parts.join(''), height };
}
