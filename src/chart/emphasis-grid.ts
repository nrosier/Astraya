/**
 * The element x modality table under the wheel.
 *
 * `elementBalance`/`modalityBalance` have been computed and tested since #45
 * but were never rendered anywhere, so the one thing a reader most often wants
 * from a chart at a glance — "is this chart top-heavy in fixed water?" —
 * required counting glyphs around the wheel by hand. This is the grid that
 * answers it: twelve cells, one per element/modality pair (which is exactly
 * one sign each), holding the bodies that fall there, with the marginal totals
 * down the right and along the bottom.
 *
 * The totals come from `elementBalance`/`modalityBalance` rather than from
 * summing the cells, deliberately: those functions accept a per-body weight
 * map, so a caller that weights the Sun and Moon more heavily than Vesta gets
 * weighted margins while the cells still show every body. Summing the drawn
 * glyphs instead would silently ignore the weights.
 *
 * Cell height is derived from the fullest cell rather than fixed, so a
 * stellium in one sign grows the table instead of overflowing it.
 */
import { elementBalance, modalityBalance } from '../astrology/emphasis.js';
import type { Element, Modality } from '../astrology/signs.js';
import { signOf } from '../astrology/signs.js';
import type { BodyId, Degrees } from '../ephemeris/types.js';
import { bodyGlyph, renderGlyph } from './glyphs.js';
import type { PanelLayout, PanelRender } from './sheet-geometry.js';
import { baselineOffset, line, rect, text } from './svg-primitives.js';

/** Row order, warm to cold — the conventional listing, and the one the labels below assume. */
const ELEMENT_ROWS: readonly Element[] = ['fire', 'earth', 'air', 'water'];
const MODALITY_COLUMNS: readonly Modality[] = ['cardinal', 'fixed', 'mutable'];

/** Three-letter headings, since a cell column is far too narrow for "Cardinal". */
const ELEMENT_LABELS: Readonly<Record<Element, string>> = {
  fire: 'FIR',
  earth: 'EAR',
  air: 'AIR',
  water: 'WAT',
};
const MODALITY_LABELS: Readonly<Record<Modality, string>> = {
  cardinal: 'CAR',
  fixed: 'FIX',
  mutable: 'MUT',
};

export interface EmphasisBody {
  readonly body: BodyId;
  /** A `bodyGlyph` key; a body without one is counted in the totals but draws nothing. */
  readonly key: string;
  readonly longitude: Degrees;
}

export interface EmphasisGridInput {
  readonly bodies: readonly EmphasisBody[];
  /** Optional per-body weights, passed straight through to the balance functions. */
  readonly weights?: ReadonlyMap<BodyId, number>;
}

const LABEL_COLUMN_FRACTION = 0.16;
const TOTAL_COLUMN_FRACTION = 0.12;
const GLYPHS_PER_CELL_ROW = 4;

/** Formats a total, dropping a pointless `.0` on the whole numbers that unweighted charts always produce. */
function formatTotal(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function renderEmphasisGridSvg(input: EmphasisGridInput, layout: PanelLayout, fontSize: number): PanelRender {
  const positions = new Map<BodyId, Degrees>(input.bodies.map((body) => [body.body, body.longitude]));
  const elements = elementBalance(positions, input.weights);
  const modalities = modalityBalance(positions, input.weights);

  // Bucket the bodies by the cell they belong in. An element/modality pair
  // picks out exactly one sign, so this is a partition, never a duplication.
  const cells = new Map<string, EmphasisBody[]>();
  for (const body of input.bodies) {
    const sign = signOf(body.longitude);
    const key = `${sign.element} ${sign.modality}`;
    const existing = cells.get(key);
    if (existing) existing.push(body);
    else cells.set(key, [body]);
  }

  const labelColumnWidth = layout.width * LABEL_COLUMN_FRACTION;
  const totalColumnWidth = layout.width * TOTAL_COLUMN_FRACTION;
  const cellWidth = (layout.width - labelColumnWidth - totalColumnWidth) / MODALITY_COLUMNS.length;
  const glyphSize = (cellWidth / GLYPHS_PER_CELL_ROW) * 0.9;
  const headerHeight = fontSize * 1.6;

  const fullestCell = Math.max(1, ...[...cells.values()].map((bodies) => bodies.length));
  const cellRows = Math.ceil(fullestCell / GLYPHS_PER_CELL_ROW);
  const rowHeight = Math.max(headerHeight, cellRows * glyphSize * 1.1 + glyphSize * 0.3);

  const parts: string[] = [];
  const columnX = (index: number): number => layout.x + labelColumnWidth + index * cellWidth;
  const rowY = (index: number): number => layout.y + headerHeight + index * rowHeight;
  const totalsX = layout.x + labelColumnWidth + MODALITY_COLUMNS.length * cellWidth;

  MODALITY_COLUMNS.forEach((modality, column) => {
    parts.push(
      text(
        columnX(column) + cellWidth / 2,
        layout.y + headerHeight - fontSize * 0.4,
        'middle',
        'chart-panel-heading',
        MODALITY_LABELS[modality],
        fontSize,
      ),
    );
  });

  ELEMENT_ROWS.forEach((element, row) => {
    const y = rowY(row);
    parts.push(
      text(
        layout.x,
        y + rowHeight / 2 + baselineOffset(fontSize),
        'start',
        'chart-panel-heading',
        ELEMENT_LABELS[element],
        fontSize,
      ),
    );

    MODALITY_COLUMNS.forEach((modality, column) => {
      const x = columnX(column);
      parts.push(rect(x, y, cellWidth, rowHeight, 'chart-emphasis-cell'));
      const bodies = cells.get(`${element} ${modality}`) ?? [];
      bodies.forEach((body, index) => {
        const definition = bodyGlyph(body.key);
        if (!definition) return;
        const cellRow = Math.floor(index / GLYPHS_PER_CELL_ROW);
        const cellColumn = index % GLYPHS_PER_CELL_ROW;
        parts.push(
          renderGlyph(
            definition,
            x + (cellColumn + 0.5) * (cellWidth / GLYPHS_PER_CELL_ROW),
            y + glyphSize * 0.15 + (cellRow + 0.5) * glyphSize * 1.1,
            glyphSize,
            `chart-glyph chart-glyph-${body.key}`,
          ),
        );
      });
    });

    parts.push(
      text(
        totalsX + totalColumnWidth / 2,
        y + rowHeight / 2 + baselineOffset(fontSize),
        'middle',
        'chart-emphasis-total',
        formatTotal(elements[element]),
        fontSize,
      ),
    );
  });

  const footerY = rowY(ELEMENT_ROWS.length);
  parts.push(line(layout.x, footerY, layout.x + layout.width, footerY, 'chart-panel-rule'));
  MODALITY_COLUMNS.forEach((modality, column) => {
    parts.push(
      text(
        columnX(column) + cellWidth / 2,
        footerY + headerHeight - fontSize * 0.4,
        'middle',
        'chart-emphasis-total',
        formatTotal(modalities[modality]),
        fontSize,
      ),
    );
  });

  return { markup: parts.join(''), height: headerHeight + ELEMENT_ROWS.length * rowHeight + headerHeight };
}
