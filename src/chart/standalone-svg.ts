/**
 * Makes a wheel SVG usable on its own (#67).
 *
 * Every renderer in this directory emits classed markup with no inline colour (see
 * `glyphs.ts`'s own doc comment) so the same shapes can be recoloured by the app's
 * light/dark theme (`app.css`) without touching the generator. That's exactly wrong for
 * a file the user downloads and opens outside the app: there is no `app.css` there, so an
 * un-styled export would render as bare black strokes with no ring/tick/aspect distinction.
 *
 * This embeds one fixed palette — `app.css`'s light theme, since that is the one meant to
 * work on white paper too — as an inline `<style>`, so the exported file needs nothing else
 * to look the way it does on screen. Kept as a literal copy of `app.css`'s own chart rules
 * (light-theme values only) rather than computed at runtime, so it works identically as a
 * PNG-rasterization source (`chart-raster.ts`) with no live DOM/CSSOM involved.
 */

const STANDALONE_STYLE = [
  'svg { background: #fbfaff; }',
  'text { font: 550 0.68rem system-ui, sans-serif; fill: #5c5878; }',
  '.wheel-ring-outer, .wheel-ring-zodiac, .chart-multiwheel-ring { fill: none; stroke: #e2dff0; stroke-width: 1.5; }',
  '.wheel-ring-inner { fill: #f3f1fa; fill-opacity: 0.3; stroke: #e2dff0; stroke-width: 1.5; }',
  '.wheel-ring-aspect { fill: #f3f1fa; fill-opacity: 0.85; stroke: #e2dff0; stroke-width: 1; opacity: 0.6; }',
  '.wheel-sign-boundary, .wheel-tick-major { stroke: #5c5878; stroke-width: 1; }',
  '.wheel-tick-medium { stroke: #5c5878; stroke-width: 0.75; opacity: 0.7; }',
  '.wheel-tick-minor { stroke: #e2dff0; stroke-width: 0.5; }',
  '.chart-multiwheel-cusp, .wheel-cusp { stroke: #e2dff0; stroke-width: 1; stroke-dasharray: 3 2; stroke-opacity: 0.4; }',
  '.chart-multiwheel-cusp-angle, .wheel-cusp-angle { stroke: #5b3fd4; stroke-width: 2; }',
  '.chart-multiwheel-axis { stroke: #5b3fd4; stroke-width: 2.5; }',
  '.chart-glyph circle, .chart-glyph path, .chart-glyph rect { fill: none; stroke: #16152b; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }',
  '.chart-glyph .glyph-fill { fill: #16152b; stroke: none; }',
  '.chart-sign-glyph circle, .chart-sign-glyph path, .chart-sign-glyph rect, .chart-sign-glyph line { fill: none; stroke: #5b3fd4; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }',
  '.chart-glyph-leader { stroke: #5c5878; stroke-width: 1; stroke-dasharray: 2 2; }',
  '.chart-house-number { fill: #5c5878; opacity: 0.85; }',
  '.chart-degree-label { fill: #5c5878; }',
  '.chart-aspect { stroke: #5c5878; stroke-width: 1; opacity: 0.45; }',
  '.chart-aspect-semisquare, .chart-aspect-square, .chart-aspect-sesquiquadrate, .chart-aspect-opposition { stroke: #b3261e; stroke-width: 2; opacity: 0.75; }',
  '.chart-aspect-conjunction, .chart-aspect-semisextile, .chart-aspect-sextile, .chart-aspect-trine { stroke: #1857c4; stroke-width: 1.5; opacity: 0.7; }',
  '.chart-aspect-quintile, .chart-aspect-biquintile, .chart-aspect-quincunx { stroke: #1f8a4c; stroke-width: 1.5; opacity: 0.6; }',
  '.chart-aspect.chart-aspect-applying { opacity: 0.95; }',
  '.chart-multiwheel-legend-swatch { fill: #5b3fd4; }',
  '.chart-multiwheel-legend-label { fill: #16152b; }',
  '.chart-sheet-title { fill: #16152b; font-weight: 650; }',
  '.chart-sheet-meta { fill: #5c5878; }',
  '.chart-panel-heading { fill: #16152b; opacity: 0.75; }',
  '.chart-panel-rule { stroke: #e2dff0; stroke-width: 1; }',
  '.chart-matrix-cell, .chart-matrix-diagonal, .chart-emphasis-cell { fill: none; stroke: #e2dff0; stroke-width: 1; }',
  '.chart-matrix-diagonal { fill: #f3f1fa; }',
  // Pre-mixed rather than `color-mix`, which SVG rasterizers support unevenly.
  // Pre-mixed rather than `color-mix`, which SVG rasterizers support unevenly.
  '.chart-matrix-cell-semisquare, .chart-matrix-cell-square, .chart-matrix-cell-sesquiquadrate, .chart-matrix-cell-opposition { fill: rgb(179 38 30 / 12%); }',
  '.chart-matrix-cell-conjunction, .chart-matrix-cell-semisextile, .chart-matrix-cell-sextile, .chart-matrix-cell-trine { fill: rgb(24 87 196 / 12%); }',
  '.chart-matrix-cell-quintile, .chart-matrix-cell-biquintile, .chart-matrix-cell-quincunx { fill: rgb(31 138 76 / 12%); }',
  '.chart-matrix-label { fill: #16152b; }',
  '.chart-matrix-orb { fill: #5c5878; }',
  '.chart-aspect-glyph circle, .chart-aspect-glyph path, .chart-aspect-glyph rect, .chart-aspect-glyph line { fill: none; stroke: #5c5878; stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }',
  '.chart-aspect-glyph-semisquare circle, .chart-aspect-glyph-semisquare path, .chart-aspect-glyph-semisquare rect, .chart-aspect-glyph-semisquare line, .chart-aspect-glyph-square circle, .chart-aspect-glyph-square path, .chart-aspect-glyph-square rect, .chart-aspect-glyph-square line, .chart-aspect-glyph-sesquiquadrate circle, .chart-aspect-glyph-sesquiquadrate path, .chart-aspect-glyph-sesquiquadrate rect, .chart-aspect-glyph-sesquiquadrate line, .chart-aspect-glyph-opposition circle, .chart-aspect-glyph-opposition path, .chart-aspect-glyph-opposition rect, .chart-aspect-glyph-opposition line { stroke: #b3261e; }',
  '.chart-aspect-glyph-conjunction circle, .chart-aspect-glyph-conjunction path, .chart-aspect-glyph-conjunction rect, .chart-aspect-glyph-conjunction line, .chart-aspect-glyph-semisextile circle, .chart-aspect-glyph-semisextile path, .chart-aspect-glyph-semisextile rect, .chart-aspect-glyph-semisextile line, .chart-aspect-glyph-trine circle, .chart-aspect-glyph-trine path, .chart-aspect-glyph-trine rect, .chart-aspect-glyph-trine line, .chart-aspect-glyph-sextile circle, .chart-aspect-glyph-sextile path, .chart-aspect-glyph-sextile rect, .chart-aspect-glyph-sextile line { stroke: #1857c4; }',
  '.chart-aspect-glyph-quintile circle, .chart-aspect-glyph-quintile path, .chart-aspect-glyph-quintile rect, .chart-aspect-glyph-quintile line, .chart-aspect-glyph-biquintile circle, .chart-aspect-glyph-biquintile path, .chart-aspect-glyph-biquintile rect, .chart-aspect-glyph-biquintile line, .chart-aspect-glyph-quincunx circle, .chart-aspect-glyph-quincunx path, .chart-aspect-glyph-quincunx rect, .chart-aspect-glyph-quincunx line { stroke: #1f8a4c; }',
  '.chart-emphasis-total { fill: #16152b; }',
  '.chart-strip-axis, .chart-strip-tick-major { stroke: #5c5878; stroke-width: 1; }',
  '.chart-strip-tick { stroke: #e2dff0; stroke-width: 0.5; }',
  '.chart-strip-label { fill: #5c5878; }',
].join('\n');

/** Inserts the fixed palette right after the opening `<svg …>` tag, before any drawn content. */
export function standaloneSvg(svgMarkup: string): string {
  const insertAt = svgMarkup.indexOf('>') + 1;
  return `${svgMarkup.slice(0, insertAt)}<style>${STANDALONE_STYLE}</style>${svgMarkup.slice(insertAt)}`;
}
