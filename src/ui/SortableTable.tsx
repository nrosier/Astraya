/**
 * A generic data table with sortable, clickable column headers, a Copy button (#44) and a
 * CSV download (#68).
 *
 * Thin wiring only: all the actual sorting and TSV/CSV-serialization logic lives in
 * `table-sort.ts`, which is plain and Vitest-testable. This component just holds the
 * current sort in state and renders it — the same "thin `.tsx`, tested `.ts`" split
 * `PersonForm.tsx`/`person-form.ts` already use, needed here too since the project has
 * no jsdom/`@testing-library/react` to test a component's rendered output directly.
 */
import { useState } from 'react';
import { downloadText } from './download.js';
import { rowsToCsv, rowsToTsv, sortRows, toggleSort, type SortState, type TableColumn } from './table-sort.js';

export function SortableTable<T>({
  caption,
  columns,
  rows,
  getRowKey,
  downloadFilename,
}: {
  readonly caption: string;
  readonly columns: readonly TableColumn<T>[];
  readonly rows: readonly T[];
  readonly getRowKey: (row: T) => string;
  /** Filename for this table's CSV download (#68), already derived from the person and chart. */
  readonly downloadFilename: string;
}): React.JSX.Element {
  const [sort, setSort] = useState<SortState>();
  const [copied, setCopied] = useState(false);
  const sorted = sortRows(rows, columns, sort);

  const copy = (): void => {
    void navigator.clipboard.writeText(rowsToTsv(columns, sorted)).then(
      () => {
        setCopied(true);
        setTimeout(() => {
          setCopied(false);
        }, 2000);
      },
      // A denied clipboard permission leaves the table exactly as it was; there is
      // nothing else to recover from, so this is deliberately silent.
      () => undefined,
    );
  };

  const download = (): void => {
    downloadText(downloadFilename, rowsToCsv(columns, sorted), 'text/csv;charset=utf-8');
  };

  return (
    <section className="data-table">
      <div className="data-table-head">
        <h3>{caption}</h3>
        <div className="data-table-actions">
          <button type="button" className="quiet" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" className="quiet" onClick={download}>
            Download CSV
          </button>
        </div>
      </div>
      <div className="data-table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  aria-sort={
                    sort?.column === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSort((current) => toggleSort(current, column.key));
                    }}
                  >
                    {column.label}
                    {sort?.column === column.key && (
                      <span aria-hidden="true">{sort.direction === 'asc' ? ' ▲' : ' ▼'}</span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={getRowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key}>{column.render ? column.render(row) : String(column.valueOf(row))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
