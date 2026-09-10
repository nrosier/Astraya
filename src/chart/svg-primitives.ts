/**
 * The handful of SVG element builders every chart module emits.
 *
 * These existed as a private copy in each renderer — four near-identical
 * `fmt`/`line`/`text`/`escapeXml` blocks that had already drifted on
 * coordinate precision. One copy keeps the generated markup uniform, which
 * matters because the tests assert on it as strings.
 *
 * Colour is never emitted here: every builder takes a class name and nothing
 * else, matching the convention across `src/chart/**` that styling lives in
 * CSS (`app.css` for the app, `standalone-svg.ts` for exports) so a single
 * palette change reaches every chart.
 */

/** Two decimals: enough for sub-pixel accuracy at any export size, short enough to keep the markup readable. */
export function fmt(value: number): string {
  return value.toFixed(2);
}

export function line(x1: number, y1: number, x2: number, y2: number, className: string): string {
  return `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" class="${className}" />`;
}

export function circle(cx: number, cy: number, r: number, className: string): string {
  return `<circle cx="${fmt(cx)}" cy="${fmt(cy)}" r="${fmt(r)}" class="${className}" />`;
}

export function rect(x: number, y: number, width: number, height: number, className: string): string {
  return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}" class="${className}" />`;
}

export type TextAnchor = 'start' | 'middle' | 'end';

export function text(
  x: number,
  y: number,
  anchor: TextAnchor,
  className: string,
  content: string,
  fontSize?: number,
): string {
  const size = fontSize === undefined ? '' : ` font-size="${fmt(fontSize)}"`;
  return `<text x="${fmt(x)}" y="${fmt(y)}" text-anchor="${anchor}"${size} class="${className}">${content}</text>`;
}

export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * How far below a point a text baseline goes to look vertically centred on it.
 * SVG anchors text at its baseline, not its middle, so every label centred on
 * a computed point needs this — `dominant-baseline` would be the declarative
 * alternative but is unevenly supported by SVG-to-raster converters, and the
 * PNG export path depends on one.
 */
export function baselineOffset(fontSize: number): number {
  return fontSize * 0.35;
}
