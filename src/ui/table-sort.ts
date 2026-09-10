/**
 * Generic, domain-agnostic sorting and TSV serialization for `SortableTable` (#44).
 *
 * Kept free of any chart or astrology knowledge — a `TableColumn` is just a
 * key, a label and an accessor — so this same pair of helpers can back every
 * data table the app ever adds, not only this issue's five.
 */

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  readonly column: string;
  readonly direction: SortDirection;
}

/** First click on a column sorts it ascending; a second click on the same column reverses it. */
export function toggleSort(current: SortState | undefined, column: string): SortState {
  if (current?.column !== column) return { column, direction: 'asc' };
  return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}

export type CellValue = string | number | boolean;

export interface TableColumn<T> {
  readonly key: string;
  readonly label: string;
  readonly valueOf: (row: T) => CellValue;
  /** Display text for the cell; defaults to `String(valueOf(row))` when omitted. */
  readonly render?: (row: T) => string;
}

function comparable(value: CellValue): string | number {
  return typeof value === 'boolean' ? Number(value) : value;
}

/** Sorts `rows` by the column named in `sort`, or returns them unchanged if no sort is active. */
export function sortRows<T>(
  rows: readonly T[],
  columns: readonly TableColumn<T>[],
  sort: SortState | undefined,
): readonly T[] {
  if (sort === undefined) return rows;
  const column = columns.find((candidate) => candidate.key === sort.column);
  if (column === undefined) return rows;
  const factor = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const valueA = comparable(column.valueOf(a));
    const valueB = comparable(column.valueOf(b));
    if (valueA < valueB) return -1 * factor;
    if (valueA > valueB) return 1 * factor;
    return 0;
  });
}

function cellText<T>(column: TableColumn<T>, row: T): string {
  return column.render ? column.render(row) : String(column.valueOf(row));
}

/** Tab-separated text of `rows` under `columns` — a header row plus one line per row, pasteable into a spreadsheet. */
export function rowsToTsv<T>(columns: readonly TableColumn<T>[], rows: readonly T[]): string {
  const header = columns.map((column) => column.label).join('\t');
  const lines = rows.map((row) => columns.map((column) => cellText(column, row)).join('\t'));
  return [header, ...lines].join('\n');
}

/** RFC 4180 quoting: only fields containing a comma, quote or newline are quoted, quotes doubled within them. */
function csvField(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** CSV text of `rows` under `columns` (#68), for a file download rather than the clipboard `rowsToTsv` serves. */
export function rowsToCsv<T>(columns: readonly TableColumn<T>[], rows: readonly T[]): string {
  const header = columns.map((column) => csvField(column.label)).join(',');
  const lines = rows.map((row) => columns.map((column) => csvField(cellText(column, row))).join(','));
  return [header, ...lines].join('\r\n');
}
