import { describe, expect, it } from 'vitest';
import type { AspectMatrixInput, MatrixBody } from '../src/chart/aspect-matrix.js';
import { renderAspectMatrixSvg } from '../src/chart/aspect-matrix.js';
import type { PanelLayout } from '../src/chart/sheet-geometry.js';

const LAYOUT: PanelLayout = { x: 0, y: 0, width: 400 };

function countClass(svg: string, className: string): number {
  return svg.split(`class="${className}"`).length - 1;
}

const BODIES: readonly MatrixBody[] = [
  { key: 'sun', label: 'Sun', name: 'Sun', longitude: 280.37, house: 4 },
  { key: 'moon', label: 'Moon', name: 'Moon', longitude: 193.32, house: 1 },
  { key: 'saturn', label: 'Saturn', name: 'Saturn', longitude: 32.05, retrograde: true, house: 8 },
  { key: 'asc', label: 'AC', name: 'ASC', longitude: 180.55 },
];

const input: AspectMatrixInput = {
  bodies: BODIES,
  aspects: [
    { aKey: 'sun', bKey: 'moon', aspectKey: 'square', orb: 2.95, signedOrb: -2.95, applying: false },
    { aKey: 'saturn', bKey: 'sun', aspectKey: 'trine', orb: 0.5, signedOrb: 0.5, applying: true },
  ],
};

/** Everything a row contributes besides its aspect cells: the table's six cells plus the diagonal. */
const TABLE_CELLS_PER_ROW = 6;

describe('renderAspectMatrixSvg', () => {
  it('returns nothing for an empty body list', () => {
    expect(renderAspectMatrixSvg({ bodies: [], aspects: [] }, LAYOUT)).toEqual({ markup: '', height: 0 });
  });

  it('draws a table row and a diagonal cell per body, plus the lower triangle of aspect cells', () => {
    const { markup } = renderAspectMatrixSvg(input, LAYOUT);
    expect(countClass(markup, 'chart-matrix-diagonal')).toBe(4);
    expect(countClass(markup, 'chart-matrix-row-cell')).toBe(4 * TABLE_CELLS_PER_ROW);
    // Lower triangle of a 4x4 grid is 4*3/2 = 6 cells.
    expect(markup.split('class="chart-matrix-cell').length - 1).toBe(6);
  });

  it('draws nothing above the diagonal, since an aspect is symmetric', () => {
    const { markup } = renderAspectMatrixSvg(input, LAYOUT);
    const cell = LAYOUT.width / (BODIES.length + 7);
    const gridX = 7 * cell;
    // Row 0 has no aspect cells to its left of the diagonal.
    const rowZeroCells = [...markup.matchAll(/<rect x="([\d.]+)" y="0\.00"[^>]*class="chart-matrix-cell/g)];
    expect(rowZeroCells).toHaveLength(0);
    // Row 3's grid cells must all sit left of its diagonal cell at column 3.
    const rowThreeY = (3 * cell).toFixed(2);
    const rowThreeGrid = [
      ...markup.matchAll(
        new RegExp(`<rect x="([\\d.]+)" y="${rowThreeY}"[^>]*class="chart-matrix-(?:cell|diagonal)`, 'g'),
      ),
    ];
    expect(rowThreeGrid.length).toBe(4); // 3 cells + the diagonal
    for (const [, x] of rowThreeGrid) {
      expect(Number(x)).toBeLessThanOrEqual(gridX + 3 * cell + 0.01);
    }
  });

  describe('positions table', () => {
    it('lists each body’s name, degree, sign and minutes, zero-padded', () => {
      const { markup } = renderAspectMatrixSvg(input, LAYOUT);
      expect(markup).toContain('>Sun<');
      expect(markup).toContain('>ASC<');
      // Sun 280.37° = 10°22' Capricorn; Saturn 32.05° = 02°03' Taurus; ASC 180.55° = 00°33' Libra.
      expect(markup).toContain('>10°<');
      expect(markup).toContain(">22'<");
      expect(markup).toContain('>02°<');
      expect(markup).toContain(">03'<");
      expect(markup).toContain('>00°<');
      expect(markup).toContain(">33'<");
    });

    it('draws each sign glyph in its element’s colour class', () => {
      const { markup } = renderAspectMatrixSvg(input, LAYOUT);
      expect(markup).toContain('chart-sign-glyph chart-sign-glyph-capricorn chart-sign-element-earth');
      expect(markup).toContain('chart-sign-glyph chart-sign-glyph-libra chart-sign-element-air');
    });

    it('prints the house for a body, and none for an angle', () => {
      const { markup } = renderAspectMatrixSvg(input, LAYOUT);
      expect(countClass(markup, 'chart-matrix-position')).toBe(
        // degree + minutes for each of 4 rows, plus a house for the 3 bodies.
        4 * 2 + 3,
      );
    });

    it('marks a retrograde body with an R, on its table glyph and on its diagonal glyph', () => {
      const { markup } = renderAspectMatrixSvg(input, LAYOUT);
      expect(markup.split('class="chart-retrograde">R<').length - 1).toBe(2);
    });
  });

  it('finds an aspect however the caller ordered its two bodies', () => {
    const { markup } = renderAspectMatrixSvg(input, LAYOUT);
    // sun-moon was given in row order, saturn-sun in reverse of it.
    expect(markup).toContain('chart-matrix-cell chart-matrix-cell-square');
    expect(markup).toContain('chart-matrix-cell chart-matrix-cell-trine');
  });

  describe('aspect cell contents', () => {
    it('prints the signed whole-degree orb with a for applying and s for separating', () => {
      const { markup } = renderAspectMatrixSvg(input, LAYOUT);
      expect(markup).toContain('>-3<'); // -2.95° rounds to -3
      expect(markup).toContain('>1<'); // +0.5° rounds to 1
      expect(markup).toContain('>s<');
      expect(markup).toContain('>a<');
    });

    it('keeps the minus on an orb that rounds to zero, as the reference does (-0)', () => {
      const { markup } = renderAspectMatrixSvg(
        {
          bodies: BODIES,
          aspects: [{ aKey: 'sun', bKey: 'moon', aspectKey: 'opposition', orb: 0.3, signedOrb: -0.3, applying: false }],
        },
        LAYOUT,
      );
      expect(markup).toContain('>-0<');
    });

    it('carries the applying/separating direction as a class, matching the wheel chords', () => {
      const { markup } = renderAspectMatrixSvg(input, LAYOUT);
      expect(markup).toContain('chart-aspect-glyph chart-aspect-glyph-square chart-aspect-separating');
      expect(markup).toContain('chart-aspect-glyph chart-aspect-glyph-trine chart-aspect-applying');
    });

    it('gives a cell within 1° of exact a heavy border, and a wider one not', () => {
      const { markup } = renderAspectMatrixSvg(input, LAYOUT);
      expect(markup).toContain('chart-matrix-cell chart-matrix-cell-trine chart-matrix-cell-tight');
      expect(markup).toContain('class="chart-matrix-cell chart-matrix-cell-square"');
    });

    it('treats a cell exactly 1° out as not tight, and a negative one by magnitude', () => {
      const tightNegative = renderAspectMatrixSvg(
        {
          bodies: BODIES,
          aspects: [{ aKey: 'sun', bKey: 'moon', aspectKey: 'square', orb: 0.75, signedOrb: -0.75, applying: true }],
        },
        LAYOUT,
      ).markup;
      const boundary = renderAspectMatrixSvg(
        {
          bodies: BODIES,
          aspects: [{ aKey: 'sun', bKey: 'moon', aspectKey: 'square', orb: 1, signedOrb: 1, applying: true }],
        },
        LAYOUT,
      ).markup;
      expect(tightNegative).toContain('chart-matrix-cell-tight');
      expect(boundary).not.toContain('chart-matrix-cell-tight');
    });
  });

  it('labels a body with no glyph by its short label instead, on the diagonal and in the table', () => {
    const { markup } = renderAspectMatrixSvg(input, LAYOUT);
    expect(markup).toContain('>AC<');
    // One label: the diagonal. The table's own glyph cell for that row uses the same fallback.
    expect(countClass(markup, 'chart-matrix-label')).toBe(2);
  });

  it('leaves an unaspected pair as a plain empty cell', () => {
    const { markup } = renderAspectMatrixSvg({ bodies: BODIES, aspects: [] }, LAYOUT);
    expect(markup).not.toContain('chart-aspect-glyph');
    expect(markup).not.toContain('chart-matrix-orb');
    expect(markup.split('class="chart-matrix-cell').length - 1).toBe(6);
  });

  it('ignores an unknown aspect key rather than drawing a broken cell', () => {
    const { markup } = renderAspectMatrixSvg(
      {
        bodies: BODIES,
        aspects: [{ aKey: 'sun', bKey: 'moon', aspectKey: 'nonsense', orb: 1, signedOrb: -1, applying: true }],
      },
      LAYOUT,
    );
    expect(markup).not.toContain('chart-aspect-glyph');
    // The orb is still reported — the aspect is real, only its symbol is unknown.
    expect(markup).toContain('>-1<');
  });

  it('keeps the first entry when a pair is given twice', () => {
    const { markup } = renderAspectMatrixSvg(
      {
        bodies: BODIES,
        aspects: [
          { aKey: 'sun', bKey: 'moon', aspectKey: 'square', orb: 1, signedOrb: 1, applying: true },
          { aKey: 'moon', bKey: 'sun', aspectKey: 'trine', orb: 5, signedOrb: 5, applying: false },
        ],
      },
      LAYOUT,
    );
    expect(markup).toContain('chart-matrix-cell-square');
    expect(markup).not.toContain('chart-matrix-cell-trine');
  });

  it('scales cells and its own height with the panel width and body count', () => {
    const narrow = renderAspectMatrixSvg(input, { x: 0, y: 0, width: 440 });
    const wide = renderAspectMatrixSvg(input, { x: 0, y: 0, width: 1760 });
    // 4 rows + 7 cells of table across 440 => 40px cells; height is 4 rows.
    expect(narrow.height).toBeCloseTo(160, 6);
    expect(wide.height).toBeCloseTo(640, 6);
  });

  describe('orb stack at small cell sizes', () => {
    /** `count` bodies in a fixed-width panel, the first two squaring at 2.25°. */
    function matrixOf(count: number): string {
      const bodies = Array.from({ length: count }, (_, index) => ({
        key: `body${String(index)}`,
        label: `B${String(index)}`,
        name: `Body ${String(index)}`,
        longitude: index * 10,
      }));
      return renderAspectMatrixSvg(
        {
          bodies,
          aspects: [{ aKey: 'body0', bKey: 'body1', aspectKey: 'square', orb: 2.25, signedOrb: -2.25, applying: true }],
        },
        LAYOUT,
      ).markup;
    }

    it('sets the orb stack while the cell is wide enough', () => {
      const markup = matrixOf(4);
      expect(markup).toContain('>-2<');
      expect(markup).toContain('>a<');
    });

    it('drops the orb stack entirely rather than setting text too small to render honestly', () => {
      const markup = matrixOf(30);
      expect(markup).not.toContain('chart-matrix-orb');
      expect(markup).not.toContain('chart-matrix-direction');
      // The aspect itself is still shown; only its exact orb moves to the Aspects table.
      expect(markup).toContain('chart-aspect-glyph-square');
    });

    it('never sets orb text below the legibility floor at any body count', () => {
      for (let count = 2; count <= 40; count += 1) {
        for (const [, size] of matrixOf(count).matchAll(
          /class="chart-matrix-(?:orb|direction)[^"]*" font-size="([\d.]+)"/g,
        )) {
          expect(Number(size)).toBeGreaterThanOrEqual(7);
        }
      }
    });
  });

  it('offsets the whole grid by the layout origin', () => {
    const { markup } = renderAspectMatrixSvg(input, { x: 50, y: 120, width: 440 });
    expect(markup).toContain('x="50.00" y="120.00"');
  });
});
