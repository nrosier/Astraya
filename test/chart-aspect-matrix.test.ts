import { describe, expect, it } from 'vitest';
import type { AspectMatrixInput, MatrixBody } from '../src/chart/aspect-matrix.js';
import { renderAspectMatrixSvg } from '../src/chart/aspect-matrix.js';
import type { PanelLayout } from '../src/chart/sheet-geometry.js';

const LAYOUT: PanelLayout = { x: 0, y: 0, width: 400 };

function countClass(svg: string, className: string): number {
  return svg.split(`class="${className}"`).length - 1;
}

const BODIES: readonly MatrixBody[] = [
  { key: 'sun', label: 'Sun' },
  { key: 'moon', label: 'Moon' },
  { key: 'mars', label: 'Mars' },
  { key: 'ascendant', label: 'AC' },
];

const input: AspectMatrixInput = {
  bodies: BODIES,
  aspects: [
    { aKey: 'sun', bKey: 'moon', aspectKey: 'square', orb: 2.25, applying: true },
    { aKey: 'mars', bKey: 'sun', aspectKey: 'trine', orb: 0.5, applying: false },
  ],
};

describe('renderAspectMatrixSvg', () => {
  it('returns nothing for an empty body list', () => {
    expect(renderAspectMatrixSvg({ bodies: [], aspects: [] }, LAYOUT)).toEqual({ markup: '', height: 0 });
  });

  it('draws a square grid: one diagonal cell per body plus the lower triangle', () => {
    const { markup } = renderAspectMatrixSvg(input, LAYOUT);
    expect(countClass(markup, 'chart-matrix-diagonal')).toBe(4);
    // Lower triangle of a 4x4 grid is 4*3/2 = 6 cells.
    expect(markup.split('class="chart-matrix-cell').length - 1).toBe(6);
  });

  it('draws nothing above the diagonal, since an aspect is symmetric', () => {
    const { markup } = renderAspectMatrixSvg(input, LAYOUT);
    const cell = LAYOUT.width / BODIES.length;
    // Row 0 has no cells to its left, so no cell rect may share its y.
    const rowZeroCells = [...markup.matchAll(/<rect x="([\d.]+)" y="0\.00"[^>]*class="chart-matrix-cell/g)];
    expect(rowZeroCells).toHaveLength(0);
    // Row 3's cells must all sit left of the diagonal at column 3.
    const rowThreeY = (3 * cell).toFixed(2);
    const rowThree = [...markup.matchAll(new RegExp(`<rect x="([\\d.]+)" y="${rowThreeY}"`, 'g'))];
    expect(rowThree.length).toBe(4); // 3 cells + the diagonal
    for (const [, x] of rowThree) {
      expect(Number(x)).toBeLessThanOrEqual(3 * cell + 1e-6);
    }
  });

  it('finds an aspect however the caller ordered its two bodies', () => {
    const { markup } = renderAspectMatrixSvg(input, LAYOUT);
    // sun-moon was given in row order, mars-sun in reverse of it.
    expect(markup).toContain('chart-matrix-cell chart-matrix-cell-square');
    expect(markup).toContain('chart-matrix-cell chart-matrix-cell-trine');
  });

  it('marks applying with a minus and separating with a plus, in degrees and minutes', () => {
    const { markup } = renderAspectMatrixSvg(input, LAYOUT);
    expect(markup).toContain(">-2°15'<"); // 2.25° applying
    expect(markup).toContain(">+0°30'<"); // 0.5° separating
  });

  it('carries the applying/separating direction as a class, matching the wheel chords', () => {
    const { markup } = renderAspectMatrixSvg(input, LAYOUT);
    expect(markup).toContain('chart-aspect-glyph chart-aspect-glyph-square chart-aspect-applying');
    expect(markup).toContain('chart-aspect-glyph chart-aspect-glyph-trine chart-aspect-separating');
  });

  it('labels a body with no glyph by its short label instead', () => {
    const { markup } = renderAspectMatrixSvg(input, LAYOUT);
    expect(markup).toContain('>AC<');
    expect(countClass(markup, 'chart-matrix-label')).toBe(1);
  });

  it('leaves an unaspected pair as a plain empty cell', () => {
    const { markup } = renderAspectMatrixSvg({ bodies: BODIES, aspects: [] }, LAYOUT);
    expect(markup).not.toContain('chart-aspect-glyph');
    expect(markup).not.toContain('chart-matrix-orb');
    expect(markup.split('class="chart-matrix-cell').length - 1).toBe(6);
  });

  it('ignores an unknown aspect key rather than drawing a broken cell', () => {
    const { markup } = renderAspectMatrixSvg(
      { bodies: BODIES, aspects: [{ aKey: 'sun', bKey: 'moon', aspectKey: 'nonsense', orb: 1, applying: true }] },
      LAYOUT,
    );
    expect(markup).not.toContain('chart-aspect-glyph');
    // The orb is still reported — the aspect is real, only its symbol is unknown.
    expect(markup).toContain(">-1°00'<");
  });

  it('keeps the first entry when a pair is given twice', () => {
    const { markup } = renderAspectMatrixSvg(
      {
        bodies: BODIES,
        aspects: [
          { aKey: 'sun', bKey: 'moon', aspectKey: 'square', orb: 1, applying: true },
          { aKey: 'moon', bKey: 'sun', aspectKey: 'trine', orb: 5, applying: false },
        ],
      },
      LAYOUT,
    );
    expect(markup).toContain('chart-matrix-cell-square');
    expect(markup).not.toContain('chart-matrix-cell-trine');
  });

  it('scales cells and its own height with the panel width and body count', () => {
    const narrow = renderAspectMatrixSvg(input, { x: 0, y: 0, width: 400 });
    const wide = renderAspectMatrixSvg(input, { x: 0, y: 0, width: 1600 });
    expect(narrow.height).toBe(400);
    expect(wide.height).toBe(1600);
    const manyBodies: readonly MatrixBody[] = [...BODIES, { key: 'venus', label: 'Venus' }];
    // One more body means one more row, at a proportionally smaller cell — so
    // the grid stays square and never overflows the panel width.
    expect(renderAspectMatrixSvg({ ...input, bodies: manyBodies }, LAYOUT).height).toBe(400);
  });

  describe('orb notation at small cell sizes', () => {
    /** `count` bodies in a fixed-width panel, the first two squaring at 2°15'. */
    function matrixOf(count: number): string {
      const bodies = Array.from({ length: count }, (_, index) => ({
        key: `body${String(index)}`,
        label: `B${String(index)}`,
      }));
      return renderAspectMatrixSvg(
        { bodies, aspects: [{ aKey: 'body0', bKey: 'body1', aspectKey: 'square', orb: 2.25, applying: true }] },
        LAYOUT,
      ).markup;
    }

    it('sets the full degrees-and-minutes orb while the cell is wide enough', () => {
      expect(matrixOf(4)).toContain(">-2°15'<");
    });

    it('falls back to whole degrees in a cell too narrow for the minutes', () => {
      const markup = matrixOf(12);
      expect(markup).not.toContain(">-2°15'<");
      expect(markup).toContain('>-2°<');
    });

    it('drops the orb entirely rather than setting text too small to render honestly', () => {
      const markup = matrixOf(20);
      expect(markup).not.toContain('chart-matrix-orb');
      // The aspect itself is still shown; only its exact orb moves to the table.
      expect(markup).toContain('chart-aspect-glyph-square');
    });

    it('never sets orb text below the legibility floor at any body count', () => {
      for (let count = 2; count <= 30; count += 1) {
        for (const [, size] of matrixOf(count).matchAll(/class="chart-matrix-orb[^"]*" font-size="([\d.]+)"/g)) {
          expect(Number(size)).toBeGreaterThanOrEqual(9);
        }
      }
    });

    it('centres the lone aspect glyph in its cell once no orb line follows it', () => {
      const cell = LAYOUT.width / 20;
      const corner = (cell / 2 - (cell * 0.52) / 2).toFixed(2);
      // Row 1, column 0: both offsets are half a cell, so the glyph sits dead
      // centre rather than riding high over a gap where the orb used to be.
      expect(matrixOf(20)).toContain(`translate(${corner} ${(cell + Number(corner)).toFixed(2)})`);
    });
  });

  it('offsets the whole grid by the layout origin', () => {
    const { markup } = renderAspectMatrixSvg(input, { x: 50, y: 120, width: 400 });
    expect(markup).toContain('x="50.00" y="120.00"');
  });
});
