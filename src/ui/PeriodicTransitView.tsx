/**
 * Daily/weekly/monthly/yearly transit forecast for a saved person (#207).
 *
 * Structured like `TransitView.tsx`: same "as of" date input (defaulting to today), same
 * worker-ephemeris lifecycle, same person-not-found / incomplete-moment / unknown-time-accuracy
 * gating — every tier here casts against the natal chart's own houses, so an unknown birth time
 * makes the whole screen as meaningless as it makes `TransitView.tsx` itself.
 *
 * The "as of" date drives all four tiers at once: it is both the daily anchor, the first day of
 * the weekly window, and (via its calendar month/year) the monthly window and the yearly tier's
 * solar-return year — `computePeriodicTransitForecast`'s own doc explains why deriving calendar-
 * month bounds is left to the caller rather than the domain layer.
 *
 * Forecast text (the issue's own title, and its "text since #55/#56 haven't landed" checklist
 * item) comes from `interpretation/compose.ts`'s `composeFallbackText`: every row below carries
 * a plain mechanically-composed sentence via the new `transit-aspect` `CorpusPlacement`
 * category, the same fallback guarantee #59 already gives every other category so a report is
 * never blank. No persona/locale corpus content has been written for `transit-aspect` yet — that
 * is unbounded prose-authoring work for #55/#56, not this issue — so every sentence here is that
 * fallback, not `ReportView.tsx`'s full persona pipeline. The structured columns stay alongside
 * the sentence for sorting and CSV export, the same as `TransitView.tsx`'s contacts table.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Aspect } from '../astrology/aspects.js';
import { bodyById } from '../astrology/bodies.js';
import { SIGNS } from '../astrology/signs.js';
import { deriveExportFilename } from '../domain/export-filename.js';
import {
  computePeriodicTransitForecast,
  type PeriodicTransitForecast,
  type PeriodicTransitPeriods,
} from '../domain/periodic-transit.js';
import { composeFallbackText } from '../interpretation/compose.js';
import type { StationEvent } from '../astrology/stations.js';
import type { TransitAspectEvent } from '../astrology/transit-events.js';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';
import { civilFromJulianDay } from '../time/julian.js';
import { todayInputValue } from './format.js';
import { SortableTable } from './SortableTable.js';
import { useStoreState } from './store-context.js';
import type { TableColumn } from './table-sort.js';
import type { BodyId, EphemerisProvider, JulianDayUT } from '../ephemeris/types.js';
import type { CorpusPlacement } from '../interpretation/schema.js';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: PeriodicTransitForecast }
  | { readonly kind: 'error'; readonly message: string };

/** UTC civil date and time, to the minute — every timestamp here is a computed UT moment, not a local one. */
function formatUtc(jd: JulianDayUT): string {
  const civil = civilFromJulianDay(jd);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(civil.year)}-${pad(civil.month)}-${pad(civil.day)} ${pad(civil.hour)}:${pad(civil.minute)} UT`;
}

function bodyName(body: BodyId): string {
  return bodyById(body)?.name ?? String(body);
}

function bodyKey(body: BodyId): string {
  return bodyById(body)?.key ?? String(body);
}

/** The `transit-aspect` fallback sentence (see file doc) for one transiting/natal pair. */
function transitAspectSentence(transiting: BodyId, natal: BodyId, aspectKey: string): string {
  const placement: CorpusPlacement = {
    category: 'transit-aspect',
    aspect: aspectKey,
    transiting: bodyKey(transiting),
    natal: bodyKey(natal),
  };
  return composeFallbackText(placement, 'en');
}

interface ContactRow {
  readonly key: string;
  readonly sentence: string;
  readonly transiting: string;
  readonly aspect: string;
  readonly natal: string;
  readonly orb: number;
  readonly applying: boolean;
}

function contactRows(aspects: readonly Aspect[]): readonly ContactRow[] {
  return aspects.map((aspect, index) => ({
    key: `${String(aspect.bodyA)}-${aspect.aspect.key}-${String(aspect.bodyB)}-${String(index)}`,
    sentence: transitAspectSentence(aspect.bodyA, aspect.bodyB, aspect.aspect.key),
    transiting: bodyName(aspect.bodyA),
    aspect: aspect.aspect.name,
    natal: bodyName(aspect.bodyB),
    orb: aspect.orb,
    applying: aspect.applying,
  }));
}

const CONTACT_COLUMNS: readonly TableColumn<ContactRow>[] = [
  { key: 'sentence', label: 'Forecast', valueOf: (row) => row.sentence },
  { key: 'orb', label: 'Orb', valueOf: (row) => row.orb, render: (row) => `${row.orb.toFixed(2)}°` },
  {
    key: 'applying',
    label: 'Applying',
    valueOf: (row) => row.applying,
    render: (row) => (row.applying ? 'Applying' : 'Separating'),
  },
];

interface ExactEventRow {
  readonly key: string;
  readonly jd: JulianDayUT;
  readonly date: string;
  readonly sentence: string;
  readonly retrograde: boolean;
}

interface StationRow {
  readonly key: string;
  readonly jd: JulianDayUT;
  readonly date: string;
  readonly body: string;
  readonly direction: string;
}

function exactEventRows(events: readonly TransitAspectEvent[]): readonly ExactEventRow[] {
  return events.map((event, index) => ({
    key: `${String(event.jd)}-${String(event.transitingBody)}-${String(event.natalBody)}-${String(index)}`,
    jd: event.jd,
    date: formatUtc(event.jd),
    sentence:
      transitAspectSentence(event.transitingBody, event.natalBody, event.aspect.key) +
      (event.retrograde ? ' (retrograde)' : ''),
    retrograde: event.retrograde,
  }));
}

const EXACT_EVENT_COLUMNS: readonly TableColumn<ExactEventRow>[] = [
  { key: 'jd', label: 'Exact', valueOf: (row) => row.jd, render: (row) => row.date },
  { key: 'sentence', label: 'Forecast', valueOf: (row) => row.sentence },
];

function stationRows(stations: readonly StationEvent[]): readonly StationRow[] {
  return stations.map((station, index) => ({
    key: `${String(station.jd)}-${String(station.body)}-${String(index)}`,
    jd: station.jd,
    date: formatUtc(station.jd),
    body: bodyName(station.body),
    direction: station.direction === 'retrograde' ? 'Turns retrograde' : 'Turns direct',
  }));
}

const STATION_COLUMNS: readonly TableColumn<StationRow>[] = [
  { key: 'jd', label: 'Exact', valueOf: (row) => row.jd, render: (row) => row.date },
  { key: 'body', label: 'Body', valueOf: (row) => row.body },
  { key: 'direction', label: 'Direction', valueOf: (row) => row.direction },
];

function signHouseLabel(sign: number, house: number): string {
  const signName = SIGNS[sign]?.name ?? `sign ${String(sign)}`;
  return `${signName}, house ${String(house)}`;
}

export function PeriodicTransitView({ personId }: { personId: string }): React.JSX.Element {
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
        // Noon for the daily anchor, same reasoning as TransitView.tsx: a date picker names a
        // day, not a moment. The monthly window is the calendar month the "as of" date falls
        // in, from its first midnight to the first midnight of the following month.
        const dayJd = await provider.julianDayFromUtc(targetDate.year, targetDate.month, targetDate.day, 12, 0, 0);
        const nextMonth = targetDate.month === 12 ? 1 : targetDate.month + 1;
        const nextMonthYear = targetDate.month === 12 ? targetDate.year + 1 : targetDate.year;
        const [monthFromJd, monthToJd] = await Promise.all([
          provider.julianDayFromUtc(targetDate.year, targetDate.month, 1, 0, 0, 0),
          provider.julianDayFromUtc(nextMonthYear, nextMonth, 1, 0, 0, 0),
        ]);
        const periods: PeriodicTransitPeriods = { dayJd, monthFromJd, monthToJd, year: targetDate.year };
        const data = await computePeriodicTransitForecast(moment, periods, provider);
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
        <h1>Forecast</h1>
        <p>
          {person.displayName || 'This person'}&rsquo;s birth record is not complete enough to calculate a forecast yet.
          Fill in the missing fields on the <a href={`#/person/${personId}`}>person page</a>.
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
        <h1>Forecast</h1>
        <p>
          A transit forecast casts against the natal houses, so it needs a known birth time.{' '}
          {person.displayName || 'This person'}&rsquo;s birth time is unknown &mdash; the same reason their chart has no
          houses.
        </p>
      </main>
    );
  }

  const data = load.kind === 'ready' ? load.data : undefined;
  const returnAscendantSign = data !== undefined ? Math.floor((data.yearly.solarReturn.houses.cusps[1] ?? 0) / 30) : 0;

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || 'Person'}</a>
      </p>
      <h1>{person.displayName ? `${person.displayName}’s forecast` : 'Forecast'}</h1>
      <p className="hint">
        What&rsquo;s happening in the sky against {person.displayName || 'this'}&rsquo;s natal chart: the transiting
        Moon and anything exact today, aspects going exact this week and this month, and this year&rsquo;s solar return.
        All times are UT.
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
          The forecast could not be calculated. {load.message}
        </p>
      )}

      {data !== undefined && (
        <>
          <section>
            <h2>Daily</h2>
            <p>
              Moon in {signHouseLabel(data.daily.moon.sign, data.daily.moon.house)}
              {data.daily.moon.position.retrograde ? ' (retrograde)' : ''}.
            </p>
            {data.daily.moonAspects.length > 0 && (
              <SortableTable
                caption="Moon's aspects to the natal chart"
                columns={CONTACT_COLUMNS}
                rows={contactRows(data.daily.moonAspects)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-daily-moon', 'csv')}
              />
            )}
            {data.daily.exactToday.length > 0 && (
              <SortableTable
                caption="Exact today"
                columns={EXACT_EVENT_COLUMNS}
                rows={exactEventRows(data.daily.exactToday)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-daily-exact', 'csv')}
              />
            )}
            {data.daily.stationsToday.length > 0 && (
              <SortableTable
                caption="Stations today"
                columns={STATION_COLUMNS}
                rows={stationRows(data.daily.stationsToday)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-daily-stations', 'csv')}
              />
            )}
          </section>

          <section>
            <h2>Weekly</h2>
            <p className="hint">
              {formatUtc(data.weekly.fromJd)} &ndash; {formatUtc(data.weekly.toJd)}
            </p>
            {data.weekly.events.length > 0 ? (
              <SortableTable
                caption="Exact this week"
                columns={EXACT_EVENT_COLUMNS}
                rows={exactEventRows(data.weekly.events)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-weekly', 'csv')}
              />
            ) : (
              <p>No aspects go exact this week.</p>
            )}
          </section>

          <section>
            <h2>Monthly</h2>
            <p>
              Sun in {signHouseLabel(data.monthly.sun.sign, data.monthly.sun.house)} this month, from{' '}
              {formatUtc(data.monthly.fromJd)} to {formatUtc(data.monthly.toJd)}.
            </p>
            {data.monthly.events.length > 0 ? (
              <SortableTable
                caption="Exact this month"
                columns={EXACT_EVENT_COLUMNS}
                rows={exactEventRows(data.monthly.events)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-monthly', 'csv')}
              />
            ) : (
              <p>No aspects go exact this month.</p>
            )}
          </section>

          <section>
            <h2>Yearly</h2>
            <p>
              Solar return for {String(data.yearly.solarReturn.year)}: {formatUtc(data.yearly.solarReturn.returnJd)},
              Ascendant in {SIGNS[returnAscendantSign]?.name ?? `sign ${String(returnAscendantSign)}`}.
            </p>
            {data.yearly.solarReturn.contacts.length > 0 && (
              <SortableTable
                caption="Solar return contacts to the natal chart"
                columns={CONTACT_COLUMNS}
                rows={contactRows(data.yearly.solarReturn.contacts)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-yearly-return', 'csv')}
              />
            )}
          </section>
        </>
      )}
    </main>
  );
}
