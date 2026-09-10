/**
 * The whole chart sheet as one SVG: header, wheel, and the three data panels.
 *
 * One document rather than four sibling elements, because every export path
 * Astraya already has — standalone SVG, PNG at 600/1200/2400, print to PDF —
 * takes a single SVG string. Splitting the sheet would mean teaching each of
 * those paths to compose, and a PNG that silently dropped the aspect grid.
 *
 * Nothing here holds a pixel figure of its own. Vertical positions come from
 * each panel's returned `height` and horizontal ones from fractions of the
 * content width, so a chart with the asteroids switched on pushes the panels
 * below it down instead of overlapping them, and the whole sheet scales with
 * the single `size` its wheel is drawn at.
 */
import type { AspectMatrixInput } from './aspect-matrix.js';
import { renderAspectMatrixSvg } from './aspect-matrix.js';
import type { DegreeStripInput } from './degree-strip.js';
import { renderDegreeStripSvg } from './degree-strip.js';
import type { EmphasisGridInput } from './emphasis-grid.js';
import { renderEmphasisGridSvg } from './emphasis-grid.js';
import type { CrossRingAspects, MultiWheelOptions, WheelRingInput } from './multi-wheel.js';
import { renderMultiWheelSvg } from './multi-wheel.js';
import type { PanelLayout } from './sheet-geometry.js';
import { resolveSheetGeometry } from './sheet-geometry.js';
import { baselineOffset, escapeXml, fmt, line, text } from './svg-primitives.js';

export interface ChartSheetInput {
  /**
   * Header lines, first one as the title. Supplied by the caller rather than
   * derived here: what belongs in a header (subject name, place, house system,
   * zodiac) is presentation, and `ChartData` deliberately carries none of it.
   */
  readonly metaLines: readonly string[];
  /** Wheel rings, innermost first — a single natal ring, or a bi-/tri-wheel. */
  readonly rings: readonly WheelRingInput[];
  readonly crossAspects?: readonly CrossRingAspects[];
  readonly matrix: AspectMatrixInput;
  readonly emphasis: EmphasisGridInput;
  readonly strip: DegreeStripInput;
}

/** Wheel options, minus `bare` — the sheet always embeds the wheel bare. */
export type ChartSheetOptions = Omit<MultiWheelOptions, 'bare'>;

/**
 * The rendered sheet and the box it drew into.
 *
 * The dimensions come back rather than being left for the caller to parse out
 * of the markup because the sheet is not square — its height depends on how
 * many bodies its panels hold — and a PNG export that assumed square would
 * squash it.
 */
export interface ChartSheet {
  readonly markup: string;
  readonly width: number;
  readonly height: number;
}

const DEFAULT_SIZE = 800;

/**
 * The lower panels sit two abreast — the square aspect grid beside the
 * element table — with the degree strip full width underneath. Fractions of
 * the content width, so the split holds at every size.
 */
const MATRIX_WIDTH_FRACTION = 0.55;
const COLUMN_GAP_FRACTION = 0.05;
const EMPHASIS_WIDTH_FRACTION = 1 - MATRIX_WIDTH_FRACTION - COLUMN_GAP_FRACTION;

export function renderChartSheetSvg(input: ChartSheetInput, options?: ChartSheetOptions): ChartSheet {
  const size = options?.size ?? DEFAULT_SIZE;
  const geometry = resolveSheetGeometry(size);
  const fontSize = geometry.panelFontSize;
  const padding = geometry.labelMargin;
  const gap = fontSize * 1.5;

  const contentWidth = size;
  const contentX = padding;
  const parts: string[] = [];
  let y = padding;

  input.metaLines.forEach((metaLine, index) => {
    const lineFontSize = index === 0 ? fontSize * 1.35 : fontSize;
    y += lineFontSize * 1.35;
    parts.push(
      text(
        contentX,
        y - baselineOffset(lineFontSize),
        'start',
        index === 0 ? 'chart-sheet-title' : 'chart-sheet-meta',
        escapeXml(metaLine),
        lineFontSize,
      ),
    );
  });
  if (input.metaLines.length > 0) {
    y += gap * 0.5;
    parts.push(line(contentX, y, contentX + contentWidth, y, 'chart-panel-rule'));
    y += gap * 0.5;
  }

  // The wheel's own coordinates run 0..size with its legend in the negative
  // margin, so it is translated as a group rather than re-parameterised.
  parts.push(
    `<g transform="translate(${fmt(contentX)} ${fmt(y)})">` +
      renderMultiWheelSvg(input.rings, input.crossAspects ?? [], { ...options, size, bare: true }) +
      `</g>`,
  );
  y += size + gap;

  const matrixWidth = contentWidth * MATRIX_WIDTH_FRACTION;
  const emphasisWidth = contentWidth * EMPHASIS_WIDTH_FRACTION;
  const matrixLayout: PanelLayout = { x: contentX, y, width: matrixWidth };
  const emphasisLayout: PanelLayout = {
    x: contentX + contentWidth - emphasisWidth,
    y,
    width: emphasisWidth,
  };
  const matrix = renderAspectMatrixSvg(input.matrix, matrixLayout);
  const emphasis = renderEmphasisGridSvg(input.emphasis, emphasisLayout, fontSize);
  parts.push(matrix.markup, emphasis.markup);
  y += Math.max(matrix.height, emphasis.height) + gap;

  const strip = renderDegreeStripSvg(
    input.strip,
    { x: contentX, y, width: contentWidth },
    fontSize,
    geometry.bodyGlyphSize,
  );
  parts.push(strip.markup);
  y += strip.height;

  const width = contentWidth + padding * 2;
  const height = y + padding;
  const markup =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}" ` +
    `width="${fmt(width)}" height="${fmt(height)}" class="chart-sheet">` +
    `${parts.join('')}</svg>`;
  return { markup, width, height };
}
