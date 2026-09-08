import { describe, expect, it } from 'vitest';
import { rowsToTsv, sortRows, toggleSort, type SortState, type TableColumn } from '../src/ui/table-sort.js';

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
