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
import { todayInputValue } from './format.js';
import { useMessages } from './messages.js';
import { PersonNotFound } from './PersonNotFound.js';
import { profectionsViewMessages } from './ProfectionsView.messages.js';
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

function columns(t: typeof profectionsViewMessages.en): readonly TableColumn<ProfectionRow>[] {
  return [
    { key: 'period', label: t.periodLabel, valueOf: (row) => row.period },
    { key: 'sign', label: t.signLabel, valueOf: (row) => row.sign },
    { key: 'degree', label: t.degLabel, valueOf: (row) => row.degree },
    { key: 'minute', label: t.minLabel, valueOf: (row) => row.minute },
    { key: 'second', label: t.secLabel, valueOf: (row) => row.second },
    { key: 'ruler', label: t.lordLabel, valueOf: (row) => row.ruler },
  ];
}

export function ProfectionsView({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);
  const t = useMessages(profectionsViewMessages);
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
    return <PersonNotFound />;
  }

  if (person.moment === undefined) {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
        </p>
        <h1>{t.profectionsFallback}</h1>
        <p>
          {t.notCompleteProfections(person.displayName || t.thisPerson)}{' '}
          <a href={`#/person/${personId}`}>{t.personPageLink}</a>.
        </p>
      </main>
    );
  }

  if (person.timeAccuracy === 'unknown') {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
        </p>
        <h1>{t.profectionsFallback}</h1>
        <p>{t.needsKnownTime(person.displayName || t.thisPerson)}</p>
      </main>
    );
  }

  const rows =
    load.kind === 'ready' ? [toRow(t.yearPeriod, load.data.year), toRow(t.monthPeriod, load.data.month)] : undefined;

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
      </p>
      <h1>{person.displayName ? t.heading(person.displayName) : t.profectionsFallback}</h1>
      <p className="hint">{t.hint}</p>

      <p>
        <label>
          {t.asOfLabel}{' '}
          <input
            type="date"
            value={asOf}
            onChange={(event) => {
              setAsOf(event.target.value);
            }}
          />
        </label>
      </p>

      {load.kind === 'loading' && <p className="status">{t.calculating}</p>}

      {load.kind === 'error' && (
        <p className="warning" role="alert">
          {t.error(load.message)}
        </p>
      )}

      {load.kind === 'ready' && (
        <>
          <p className="hint">
            {t.ageLine(`${load.data.age.toFixed(2)}${load.data.age < 0 ? ` ${t.beforeBirth}` : ''}`)}
          </p>
          {rows !== undefined && (
            <SortableTable
              caption={t.profectionsCaption}
              columns={columns(t)}
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
