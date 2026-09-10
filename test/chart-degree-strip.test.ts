import { describe, expect, it } from 'vitest';
import type { DegreeStripInput } from '../src/chart/degree-strip.js';
import { renderDegreeStripSvg, spreadLinear } from '../src/chart/degree-strip.js';
import type { PanelLayout } from '../src/chart/sheet-geometry.js';

const LAYOUT: PanelLayout = { x: 0, y: 0, width: 600 };
const FONT_SIZE = 12;
const GLYPH_SIZE = 18;

function countClass(svg: string, className: string): number {
  return svg.split(`class="${className}"`).length - 1;
}

describe('spreadLinear', () => {
  it('leaves values already far enough apart untouched', () => {
    expect(spreadLinear([0, 10, 20, 30], 0, 30, 5)).toEqual([0, 10, 20, 30]);
  });

  it('returns an empty result for no values', () => {
    expect(spreadLinear([], 0, 30, 5)).toEqual([]);
  });

  it('pushes a crowded pair apart symmetrically', () => {
    const [a, b] = spreadLinear([15, 15.5], 0, 30, 4) as readonly [number, number];
    expect(b - a).toBeCloseTo(4, 6);
    // The midpoint is preserved: neither glyph is favoured over the other.
    expect((a + b) / 2).toBeCloseTo(15.25, 6);
  });

  it('returns positions in the caller order, not sorted order', () => {
    // Sorted, the crowded pair is 20/20.5 and spreads to 18.25/22.25 — those
    // must come back in slots 0 and 1, where the caller put them.
    const result = spreadLinear([20, 20.5, 5], 0, 30, 4);
    expect(result.map((value) => Number(value.toFixed(4)))).toEqual([18.25, 22.25, 5]);
  });

  it('preserves relative order along the axis', () => {
    const values = [3, 3.1, 3.2, 3.3, 20];
    const result = spreadLinear(values, 0, 30, 3);
    const sorted = [...result].sort((a, b) => a - b);
    expect(result).toEqual(sorted);
  });

  it('clamps at the lower end rather than pushing a glyph off the axis', () => {
    const result = spreadLinear([0, 0.2], 0, 30, 6);
    expect(result[0]).toBe(0);
    expect(result[1]).toBeCloseTo(6, 6);
  });

  it('clamps at the upper end too', () => {
    const result = spreadLinear([29.8, 30], 0, 30, 6);
    expect(result[1]).toBe(30);
    expect(result[0]).toBeCloseTo(24, 6);
  });

  it('keeps every value inside the domain when they cannot all fit', () => {
    // Ten glyphs needing 5 degrees each will not fit in 30 degrees; the clamp
    // wins and the strip is merely crowded rather than overflowing.
    const result = spreadLinear(
      Array.from({ length: 10 }, () => 15),
      0,
      30,
      5,
    );
    for (const value of result) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(30);
    }
  });

  it('is pure: the input array is not mutated', () => {
    const values = [15, 15.2, 15.4];
    const copy = [...values];
    spreadLinear(values, 0, 30, 5);
    expect(values).toEqual(copy);
  });

  it('is deterministic for the same input', () => {
    const values = [1, 1.1, 8, 8.05, 29.9];
    expect(spreadLinear(values, 0, 30, 3)).toEqual(spreadLinear(values, 0, 30, 3));
  });
});

describe('renderDegreeStripSvg', () => {
  const input: DegreeStripInput = {
    bodies: [
      { key: 'sun', longitude: 10.5 }, // 10°30' Aries
      { key: 'moon', longitude: 130.5 }, // 10°30' Leo — same degree, different sign
      { key: 'saturn', longitude: 295 }, // 25° Capricorn
    ],
  };

  it('draws one axis with a tick at every whole degree', () => {
    const { markup } = renderDegreeStripSvg(input, LAYOUT, FONT_SIZE, GLYPH_SIZE);
    expect(countClass(markup, 'chart-strip-axis')).toBe(1);
    // 0..30 inclusive is 31 ticks, 7 of which (0,5,...,30) are major.
    expect(countClass(markup, 'chart-strip-tick-major')).toBe(7);
    expect(countClass(markup, 'chart-strip-tick')).toBe(24);
  });

  it('labels every fifth degree', () => {
    const { markup } = renderDegreeStripSvg(input, LAYOUT, FONT_SIZE, GLYPH_SIZE);
    expect(countClass(markup, 'chart-strip-label')).toBe(7);
    for (const degree of [0, 5, 10, 15, 20, 25, 30]) {
      expect(markup).toContain(`>${String(degree)}°<`);
    }
  });

  it('plots each body by its degree within its sign, ignoring the sign', () => {
    const { markup } = renderDegreeStripSvg(input, LAYOUT, FONT_SIZE, GLYPH_SIZE);
    expect(countClass(markup, 'chart-glyph chart-glyph-sun')).toBe(1);
    expect(countClass(markup, 'chart-glyph chart-glyph-moon')).toBe(1);
    expect(countClass(markup, 'chart-glyph chart-glyph-saturn')).toBe(1);
  });

  it('spreads a same-degree cluster and leads each moved glyph back to its true degree', () => {
    const { markup } = renderDegreeStripSvg(input, LAYOUT, FONT_SIZE, GLYPH_SIZE);
    // Sun and Moon share 10°30', so both must move; Saturn at 25° does not.
    expect(countClass(markup, 'chart-glyph-leader')).toBe(2);
  });

  it('draws no leader line when nothing had to move', () => {
    const { markup } = renderDegreeStripSvg(
      {
        bodies: [
          { key: 'sun', longitude: 5 },
          { key: 'saturn', longitude: 25 },
        ],
      },
      LAYOUT,
      FONT_SIZE,
      GLYPH_SIZE,
    );
    expect(markup).not.toContain('chart-glyph-leader');
  });

  it('skips a body with no glyph rather than drawing an empty marker', () => {
    const { markup } = renderDegreeStripSvg(
      { bodies: [{ key: 'nonesuch', longitude: 12 }] },
      LAYOUT,
      FONT_SIZE,
      GLYPH_SIZE,
    );
    expect(markup).not.toContain('chart-glyph');
  });

  it('renders the bare axis for an empty body list', () => {
    const { markup, height } = renderDegreeStripSvg({ bodies: [] }, LAYOUT, FONT_SIZE, GLYPH_SIZE);
    expect(countClass(markup, 'chart-strip-axis')).toBe(1);
    expect(markup).not.toContain('chart-glyph');
    expect(height).toBeGreaterThan(0);
  });

  it('scales the axis with the panel width', () => {
    const narrow = renderDegreeStripSvg(input, { x: 0, y: 0, width: 600 }, FONT_SIZE, GLYPH_SIZE);
    const wide = renderDegreeStripSvg(input, { x: 0, y: 0, width: 1800 }, FONT_SIZE, GLYPH_SIZE);
    const axisEnd = (svg: string): number => {
      const match = /<line x1="[\d.-]+" y1="[\d.-]+" x2="([\d.-]+)"[^>]*class="chart-strip-axis"/.exec(svg);
      if (!match) throw new Error('no axis line found');
      return Number(match[1]);
    };
    expect(axisEnd(narrow.markup)).toBeCloseTo(600, 6);
    expect(axisEnd(wide.markup)).toBeCloseTo(1800, 6);
  });

  it('offsets everything by the layout origin', () => {
    const { markup } = renderDegreeStripSvg(input, { x: 40, y: 300, width: 600 }, FONT_SIZE, GLYPH_SIZE);
    expect(markup).toContain('x1="40.00"');
    expect(markup).toContain('x2="640.00"');
  });
});
