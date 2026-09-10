import { describe, expect, it } from 'vitest';
import type { EmphasisGridInput } from '../src/chart/emphasis-grid.js';
import { renderEmphasisGridSvg } from '../src/chart/emphasis-grid.js';
import type { PanelLayout } from '../src/chart/sheet-geometry.js';

const LAYOUT: PanelLayout = { x: 0, y: 0, width: 400 };
const FONT_SIZE = 16;

function countClass(svg: string, className: string): number {
  return svg.split(`class="${className}"`).length - 1;
}

/**
 * One body per element, at a known sign: Aries (fire/cardinal), Taurus
 * (earth/fixed), Gemini (air/mutable), Cancer (water/cardinal).
 */
const input: EmphasisGridInput = {
  bodies: [
    { body: 1, key: 'sun', longitude: 10 },
    { body: 2, key: 'moon', longitude: 40 },
    { body: 3, key: 'mercury', longitude: 70 },
    { body: 4, key: 'venus', longitude: 100 },
  ],
};

describe('renderEmphasisGridSvg', () => {
  it('draws the twelve element x modality cells', () => {
    const { markup } = renderEmphasisGridSvg(input, LAYOUT, FONT_SIZE);
    expect(countClass(markup, 'chart-emphasis-cell')).toBe(12);
  });

  it('heads the columns by modality and the rows by element', () => {
    const { markup } = renderEmphasisGridSvg(input, LAYOUT, FONT_SIZE);
    for (const heading of ['CAR', 'FIX', 'MUT', 'FIR', 'EAR', 'AIR', 'WAT']) {
      expect(markup).toContain(`>${heading}<`);
    }
    expect(countClass(markup, 'chart-panel-heading')).toBe(7);
  });

  it('places each body in the one cell its sign belongs to', () => {
    const { markup } = renderEmphasisGridSvg(input, LAYOUT, FONT_SIZE);
    for (const key of ['sun', 'moon', 'mercury', 'venus']) {
      expect(countClass(markup, `chart-glyph chart-glyph-${key}`)).toBe(1);
    }
  });

  it('reports element totals down the right and modality totals along the bottom', () => {
    const { markup } = renderEmphasisGridSvg(input, LAYOUT, FONT_SIZE);
    // 4 element rows + 3 modality columns = 7 totals; every element holds one
    // body, cardinal holds two (Aries and Cancer), fixed and mutable one each.
    expect(countClass(markup, 'chart-emphasis-total')).toBe(7);
    expect(markup).toContain('>2<');
    expect(markup.split('>1<').length - 1).toBe(6);
  });

  it('passes weights through to the totals while still drawing every body', () => {
    const weighted = renderEmphasisGridSvg({ ...input, weights: new Map([[1, 3]]) }, LAYOUT, FONT_SIZE);
    // The Sun now counts 3 towards fire, and towards cardinal alongside Venus.
    expect(weighted.markup).toContain('>3<');
    expect(weighted.markup).toContain('>4<');
    expect(countClass(weighted.markup, 'chart-glyph chart-glyph-sun')).toBe(1);
  });

  it('shows a fractional weighted total to one decimal rather than a bare integer', () => {
    const { markup } = renderEmphasisGridSvg(
      { bodies: [{ body: 1, key: 'sun', longitude: 10 }], weights: new Map([[1, 1.5]]) },
      LAYOUT,
      FONT_SIZE,
    );
    expect(markup).toContain('>1.5<');
  });

  it('grows its rows for a stellium instead of overflowing the cell', () => {
    const stellium: EmphasisGridInput = {
      bodies: Array.from({ length: 9 }, (_, index) => ({
        body: index + 1,
        key: 'sun',
        longitude: index * 2, // all in Aries: fire, cardinal
      })),
    };
    const sparse = renderEmphasisGridSvg(input, LAYOUT, FONT_SIZE);
    const crowded = renderEmphasisGridSvg(stellium, LAYOUT, FONT_SIZE);
    expect(crowded.height).toBeGreaterThan(sparse.height);
    expect(countClass(crowded.markup, 'chart-glyph chart-glyph-sun')).toBe(9);
  });

  it('counts a body with no glyph in the totals without drawing one', () => {
    const { markup } = renderEmphasisGridSvg(
      { bodies: [{ body: 1, key: 'nonesuch', longitude: 10 }] },
      LAYOUT,
      FONT_SIZE,
    );
    expect(markup).not.toContain('chart-glyph');
    expect(markup).toContain('>1<');
  });

  it('renders an empty chart as a grid of zeroes rather than failing', () => {
    const { markup, height } = renderEmphasisGridSvg({ bodies: [] }, LAYOUT, FONT_SIZE);
    expect(countClass(markup, 'chart-emphasis-cell')).toBe(12);
    expect(markup.split('>0<').length - 1).toBe(7);
    expect(height).toBeGreaterThan(0);
  });

  it('scales with the panel width and offsets by the layout origin', () => {
    const narrow = renderEmphasisGridSvg(input, { x: 0, y: 0, width: 400 }, FONT_SIZE);
    const wide = renderEmphasisGridSvg(input, { x: 0, y: 0, width: 1600 }, FONT_SIZE);
    const firstCellWidth = (svg: string): number => {
      const match = /<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)"/.exec(svg);
      if (!match) throw new Error('no cell rect found');
      return Number(match[1]);
    };
    expect(firstCellWidth(wide.markup)).toBeCloseTo(firstCellWidth(narrow.markup) * 4, 6);

    const firstCellOrigin = (svg: string): readonly [number, number] => {
      const match = /<rect x="([\d.]+)" y="([\d.]+)"/.exec(svg);
      if (!match) throw new Error('no cell rect found');
      return [Number(match[1]), Number(match[2])];
    };
    const offset = renderEmphasisGridSvg(input, { x: 30, y: 200, width: 400 }, FONT_SIZE);
    const [baseX, baseY] = firstCellOrigin(narrow.markup);
    const [movedX, movedY] = firstCellOrigin(offset.markup);
    expect(movedX - baseX).toBeCloseTo(30, 6);
    expect(movedY - baseY).toBeCloseTo(200, 6);
  });
});
