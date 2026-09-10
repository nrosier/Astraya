import { describe, expect, it } from 'vitest';
import { rowsToCsv, rowsToTsv, sortRows, toggleSort, type SortState, type TableColumn } from '../src/ui/table-sort.js';

interface Row {
  readonly name: string;
  readonly count: number;
  readonly flagged: boolean;
}

const COLUMNS: readonly TableColumn<Row>[] = [
  { key: 'name', label: 'Name', valueOf: (row) => row.name },
  { key: 'count', label: 'Count', valueOf: (row) => row.count },
  { key: 'flagged', label: 'Flagged', valueOf: (row) => row.flagged, render: (row) => (row.flagged ? 'yes' : 'no') },
];

const ROWS: readonly Row[] = [
  { name: 'Charlie', count: 3, flagged: false },
  { name: 'Alice', count: 1, flagged: true },
  { name: 'Bob', count: 2, flagged: false },
];

describe('toggleSort (#44)', () => {
  it('sorts a fresh column ascending', () => {
    expect(toggleSort(undefined, 'name')).toEqual({ column: 'name', direction: 'asc' });
  });

  it('reverses direction on a second click of the same column', () => {
    const first = toggleSort(undefined, 'name');
    expect(toggleSort(first, 'name')).toEqual({ column: 'name', direction: 'desc' });
  });

  it('starts a newly clicked column ascending, even if another column was descending', () => {
    const state: SortState = { column: 'name', direction: 'desc' };
    expect(toggleSort(state, 'count')).toEqual({ column: 'count', direction: 'asc' });
  });
});

describe('sortRows (#44)', () => {
  it('returns the rows unchanged when no sort is active', () => {
    expect(sortRows(ROWS, COLUMNS, undefined)).toBe(ROWS);
  });

  it('sorts by a string column ascending', () => {
    const sorted = sortRows(ROWS, COLUMNS, { column: 'name', direction: 'asc' });
    expect(sorted.map((row) => row.name)).toEqual(['Alice', 'Bob', 'Charlie']);
  });

  it('sorts by a numeric column descending', () => {
    const sorted = sortRows(ROWS, COLUMNS, { column: 'count', direction: 'desc' });
    expect(sorted.map((row) => row.count)).toEqual([3, 2, 1]);
  });

  it('sorts a boolean column by treating true as greater than false', () => {
    const sorted = sortRows(ROWS, COLUMNS, { column: 'flagged', direction: 'desc' });
    expect(sorted[0]?.flagged).toBe(true);
  });

  it('does not mutate the input array', () => {
    const copy = [...ROWS];
    sortRows(ROWS, COLUMNS, { column: 'name', direction: 'asc' });
    expect(ROWS).toEqual(copy);
  });

  it('returns the rows unchanged when the sort names a column that does not exist', () => {
    expect(sortRows(ROWS, COLUMNS, { column: 'nonexistent', direction: 'asc' })).toBe(ROWS);
  });
});

describe('rowsToTsv (#44)', () => {
  it('renders a header row followed by one tab-separated line per row', () => {
    const tsv = rowsToTsv(COLUMNS, [{ name: 'Alice', count: 1, flagged: true }]);
    expect(tsv).toBe('Name\tCount\tFlagged\nAlice\t1\tyes');
  });

  it('falls back to String(valueOf(row)) for a column with no render function', () => {
    const tsv = rowsToTsv(COLUMNS, [{ name: 'Alice', count: 1, flagged: true }]);
    expect(tsv).toContain('Alice\t1');
  });

  it('renders an empty row list as just the header', () => {
    expect(rowsToTsv(COLUMNS, [])).toBe('Name\tCount\tFlagged');
  });
});

describe('rowsToCsv (#68)', () => {
  it('renders a header row followed by one comma-separated line per row, CRLF-terminated', () => {
    const csv = rowsToCsv(COLUMNS, [{ name: 'Alice', count: 1, flagged: true }]);
    expect(csv).toBe('Name,Count,Flagged\r\nAlice,1,yes');
  });

  it('renders an empty row list as just the header', () => {
    expect(rowsToCsv(COLUMNS, [])).toBe('Name,Count,Flagged');
  });

  it('quotes a field containing a comma', () => {
    const csv = rowsToCsv(COLUMNS, [{ name: 'Doe, Jane', count: 1, flagged: false }]);
    expect(csv).toContain('"Doe, Jane"');
  });

  it('quotes and doubles embedded quotes in a field', () => {
    const csv = rowsToCsv(COLUMNS, [{ name: 'The "Great" One', count: 1, flagged: false }]);
    expect(csv).toContain('"The ""Great"" One"');
  });

  it('quotes a field containing a newline', () => {
    const csv = rowsToCsv(COLUMNS, [{ name: 'Line1\nLine2', count: 1, flagged: false }]);
    expect(csv).toContain('"Line1\nLine2"');
  });

  it('leaves a plain field unquoted', () => {
    const csv = rowsToCsv(COLUMNS, [{ name: 'Alice', count: 1, flagged: true }]);
    expect(csv.split('\r\n')[1]).toBe('Alice,1,yes');
  });
});
