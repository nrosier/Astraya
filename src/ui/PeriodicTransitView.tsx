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
import { useMessages } from './messages.js';
import { periodicTransitViewMessages } from './PeriodicTransitView.messages.js';
import { PersonNotFound } from './PersonNotFound.js';
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

function contactColumns(t: typeof periodicTransitViewMessages.en): readonly TableColumn<ContactRow>[] {
  return [
    { key: 'sentence', label: t.forecastLabel, valueOf: (row) => row.sentence },
    { key: 'orb', label: t.orbLabel, valueOf: (row) => row.orb, render: (row) => `${row.orb.toFixed(2)}°` },
    {
      key: 'applying',
      label: t.applyingLabel,
      valueOf: (row) => row.applying,
      render: (row) => (row.applying ? t.applying : t.separating),
    },
  ];
}

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

function exactEventRows(
  events: readonly TransitAspectEvent[],
  t: typeof periodicTransitViewMessages.en,
): readonly ExactEventRow[] {
  return events.map((event, index) => ({
    key: `${String(event.jd)}-${String(event.transitingBody)}-${String(event.natalBody)}-${String(index)}`,
    jd: event.jd,
    date: formatUtc(event.jd),
    sentence:
      transitAspectSentence(event.transitingBody, event.natalBody, event.aspect.key) +
      (event.retrograde ? ` ${t.retrograde}` : ''),
    retrograde: event.retrograde,
  }));
}

function exactEventColumns(t: typeof periodicTransitViewMessages.en): readonly TableColumn<ExactEventRow>[] {
  return [
    { key: 'jd', label: t.exactLabel, valueOf: (row) => row.jd, render: (row) => row.date },
    { key: 'sentence', label: t.forecastLabel, valueOf: (row) => row.sentence },
  ];
}

function stationRows(
  stations: readonly StationEvent[],
  t: typeof periodicTransitViewMessages.en,
): readonly StationRow[] {
  return stations.map((station, index) => ({
    key: `${String(station.jd)}-${String(station.body)}-${String(index)}`,
    jd: station.jd,
    date: formatUtc(station.jd),
    body: bodyName(station.body),
    direction: station.direction === 'retrograde' ? t.turnsRetrograde : t.turnsDirect,
  }));
}

function stationColumns(t: typeof periodicTransitViewMessages.en): readonly TableColumn<StationRow>[] {
  return [
    { key: 'jd', label: t.exactLabel, valueOf: (row) => row.jd, render: (row) => row.date },
    { key: 'body', label: t.bodyLabel, valueOf: (row) => row.body },
    { key: 'direction', label: t.directionLabel, valueOf: (row) => row.direction },
  ];
}

function signHouseLabel(sign: number, house: number, t: typeof periodicTransitViewMessages.en): string {
  const signName = SIGNS[sign]?.name ?? t.signFallback(String(sign));
  return `${signName}${t.houseSuffix(house)}`;
}

export function PeriodicTransitView({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);
  const t = useMessages(periodicTransitViewMessages);
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
    return <PersonNotFound />;
  }

  if (person.moment === undefined) {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
        </p>
        <h1>{t.forecastFallback}</h1>
        <p>
          {t.notCompleteForecast(person.displayName || t.thisPerson)}{' '}
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
        <h1>{t.forecastFallback}</h1>
        <p>{t.needsKnownTime(person.displayName || t.thisPerson)}</p>
      </main>
    );
  }

  const data = load.kind === 'ready' ? load.data : undefined;
  const returnAscendantSign = data !== undefined ? Math.floor((data.yearly.solarReturn.houses.cusps[1] ?? 0) / 30) : 0;

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
      </p>
      <h1>{person.displayName ? t.heading(person.displayName) : t.forecastFallback}</h1>
      <p className="hint">{t.hint(person.displayName || t.thisFallback)}</p>

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

      {data !== undefined && (
        <>
          <section>
            <h2>{t.dailyHeading}</h2>
            <p>
              {t.moonInLabel} {signHouseLabel(data.daily.moon.sign, data.daily.moon.house, t)}
              {data.daily.moon.position.retrograde ? ` ${t.retrograde}` : ''}.
            </p>
            {data.daily.moonAspects.length > 0 && (
              <SortableTable
                caption={t.moonAspectsCaption}
                columns={contactColumns(t)}
                rows={contactRows(data.daily.moonAspects)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-daily-moon', 'csv')}
              />
            )}
            {data.daily.exactToday.length > 0 && (
              <SortableTable
                caption={t.exactTodayCaption}
                columns={exactEventColumns(t)}
                rows={exactEventRows(data.daily.exactToday, t)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-daily-exact', 'csv')}
              />
            )}
            {data.daily.stationsToday.length > 0 && (
              <SortableTable
                caption={t.stationsTodayCaption}
                columns={stationColumns(t)}
                rows={stationRows(data.daily.stationsToday, t)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-daily-stations', 'csv')}
              />
            )}
          </section>

          <section>
            <h2>{t.weeklyHeading}</h2>
            <p className="hint">
              {formatUtc(data.weekly.fromJd)} &ndash; {formatUtc(data.weekly.toJd)}
            </p>
            {data.weekly.events.length > 0 ? (
              <SortableTable
                caption={t.exactThisWeekCaption}
                columns={exactEventColumns(t)}
                rows={exactEventRows(data.weekly.events, t)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-weekly', 'csv')}
              />
            ) : (
              <p>{t.noAspectsWeek}</p>
            )}
          </section>

          <section>
            <h2>{t.monthlyHeading}</h2>
            <p>
              {t.sunInThisMonth(
                signHouseLabel(data.monthly.sun.sign, data.monthly.sun.house, t),
                formatUtc(data.monthly.fromJd),
                formatUtc(data.monthly.toJd),
              )}
            </p>
            {data.monthly.events.length > 0 ? (
              <SortableTable
                caption={t.exactThisMonthCaption}
                columns={exactEventColumns(t)}
                rows={exactEventRows(data.monthly.events, t)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-monthly', 'csv')}
              />
            ) : (
              <p>{t.noAspectsMonth}</p>
            )}
          </section>

          <section>
            <h2>{t.yearlyHeading}</h2>
            <p>
              {t.solarReturnSentence(
                String(data.yearly.solarReturn.year),
                formatUtc(data.yearly.solarReturn.returnJd),
                SIGNS[returnAscendantSign]?.name ?? t.signFallback(String(returnAscendantSign)),
              )}
            </p>
            {data.yearly.solarReturn.contacts.length > 0 && (
              <SortableTable
                caption={t.solarReturnContactsCaption}
                columns={contactColumns(t)}
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
