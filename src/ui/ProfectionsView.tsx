/**
 * Annual and monthly profections for one person (#168), computed as of a chosen date.
 *
 * Profections rotate the natal Ascendant, so — same as `ChartView.tsx`'s houses/angles
 * tables — this whole screen is meaningless for a person whose birth time is unknown and
 * is gated the same way (`showHouses` there, `personReady` here).
 *
 * "As of" defaults to today because that is the question profections are usually asked to
 * answer ("whose year is it right now"), but any date works — including one before birth,
 * which comes back as a negative age rather than an error (`computeProfections`'s own doc
 * comment). The date input is a plain civil date at noon local, converted through the same
 * `julianDayFromUtc` the engine uses everywhere else a picked date becomes a Julian day.
 */
import { useEffect, useMemo, useState } from 'react';
import { bodyById } from '../astrology/bodies.js';
import { degreeParts } from '../domain/chart-tables.js';
import { deriveExportFilename } from '../domain/export-filename.js';
import { computeProfections, type ProfectedPeriod, type ProfectionData } from '../domain/profections.js';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';
import { SortableTable } from './SortableTable.js';
import { useStoreState } from './store-context.js';
import type { TableColumn } from './table-sort.js';
import type { EphemerisProvider } from '../ephemeris/types.js';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: ProfectionData }
  | { readonly kind: 'error'; readonly message: string };

interface ProfectionRow {
  readonly period: string;
  readonly sign: string;
  readonly degree: number;
  readonly minute: number;
  readonly second: number;
  readonly ruler: string;
}

function toRow(period: string, profected: ProfectedPeriod): ProfectionRow {
  const parts = degreeParts(profected.longitude);
  return { period, ...parts, ruler: bodyById(profected.ruler)?.name ?? String(profected.ruler) };
}

const COLUMNS: readonly TableColumn<ProfectionRow>[] = [
  { key: 'period', label: 'Period', valueOf: (row) => row.period },
  { key: 'sign', label: 'Sign', valueOf: (row) => row.sign },
  { key: 'degree', label: 'Deg', valueOf: (row) => row.degree },
  { key: 'minute', label: 'Min', valueOf: (row) => row.minute },
  { key: 'second', label: 'Sec', valueOf: (row) => row.second },
  { key: 'ruler', label: 'Lord', valueOf: (row) => row.ruler },
];

/** Today's date as a `<input type="date">` value, in the visitor's local calendar. */
function todayInputValue(): string {
  const now = new Date();
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function ProfectionsView({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);
  const [asOf, setAsOf] = useState(todayInputValue);
  const [provider, setProvider] = useState<EphemerisProvider | undefined>(undefined);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    const worker = new WorkerEphemerisProvider();
    const effect = { cancelled: false };
    void worker.initialize().then(() => {
      if (!effect.cancelled) setProvider(worker);
    });
    return () => {
      effect.cancelled = true;
      void worker.dispose();
    };
  }, []);

  const targetDate = useMemo(() => {
    const [year, month, day] = asOf.split('-').map(Number);
    return year !== undefined && month !== undefined && day !== undefined ? { year, month, day } : undefined;
  }, [asOf]);

  useEffect(() => {
    if (person?.moment === undefined || provider === undefined || targetDate === undefined) return undefined;
    const moment = person.moment;
    const effect = { cancelled: false };
    setLoad({ kind: 'loading' });

    void (async () => {
      try {
        // Noon, not midnight: a date picker names a day, not a moment, and noon keeps the
        // civil day intact under any timezone offset the target's own calculation might
        // apply — midnight on a date near a DST/offset boundary can round to the day before.
        const targetJd = await provider.julianDayFromUtc(targetDate.year, targetDate.month, targetDate.day, 12, 0, 0);
        const data = await computeProfections(moment, targetJd, provider);
        if (!effect.cancelled) setLoad({ kind: 'ready', data });
      } catch (error) {
        if (!effect.cancelled)
          setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      effect.cancelled = true;
    };
  }, [person, provider, targetDate]);

  if (person === undefined) {
    return (
      <main className="shell">
        <p className="back">
          <a href="#/people">&larr; People</a>
        </p>
        <h1>Not found</h1>
        <p>
          There is no person with that id on this device. If they were deleted, they can be restored from the{' '}
          <a href="#/people">people list</a>.
        </p>
      </main>
    );
  }

  if (person.moment === undefined) {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || 'Person'}</a>
        </p>
        <h1>Profections</h1>
        <p>
          {person.displayName || 'This person'}&rsquo;s birth record is not complete enough to calculate profections
          yet. Fill in the missing fields on the <a href={`#/person/${personId}`}>person page</a>.
        </p>
      </main>
    );
  }

  if (person.timeAccuracy === 'unknown') {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || 'Person'}</a>
        </p>
        <h1>Profections</h1>
        <p>
          Profections rotate the natal Ascendant, so they need a known birth time. {person.displayName || 'This person'}
          &rsquo;s birth time is unknown &mdash; the same reason their chart has no houses.
        </p>
      </main>
    );
  }

  const rows = load.kind === 'ready' ? [toRow('Year', load.data.year), toRow('Month', load.data.month)] : undefined;

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || 'Person'}</a>
      </p>
      <h1>{person.displayName ? `${person.displayName}’s profections` : 'Profections'}</h1>
      <p className="hint">
        Annual and monthly Hellenistic profections: a house-per-year rotation of the natal Ascendant, using the
        traditional (pre-outer-planet) rulership scheme for &ldquo;Lord of the Year/Month.&rdquo;
      </p>

      <p>
        <label>
          As of{' '}
          <input
            type="date"
            value={asOf}
            onChange={(event) => {
              setAsOf(event.target.value);
            }}
          />
        </label>
      </p>

      {load.kind === 'loading' && <p className="status">Calculating&hellip;</p>}

      {load.kind === 'error' && (
        <p className="warning" role="alert">
          Profections could not be calculated. {load.message}
        </p>
      )}

      {load.kind === 'ready' && (
        <>
          <p className="hint">
            Age {load.data.age.toFixed(2)} {load.data.age < 0 ? '(before birth)' : ''}
          </p>
          {rows !== undefined && (
            <SortableTable
              caption="Profections"
              columns={COLUMNS}
              rows={rows}
              getRowKey={(row) => row.period}
              downloadFilename={deriveExportFilename(person.displayName, 'profections', 'csv')}
            />
          )}
        </>
      )}
    </main>
  );
}
