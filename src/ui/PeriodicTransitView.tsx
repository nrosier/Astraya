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
import { useEphemerisProvider } from './EphemerisProviderContext.js';
import type { Aspect } from '../astrology/aspects.js';
import { bodyByKey, bodyById } from '../astrology/bodies.js';
import { SIGNS } from '../astrology/signs.js';
import { bodyDisplayName, signDisplayName } from './astro-names.messages.js';
import { deriveExportFilename } from '../domain/export-filename.js';
import {
  computePeriodicTransitForecast,
  type PeriodicTransitForecast,
  type PeriodicTransitPeriods,
} from '../domain/periodic-transit.js';
import { computePlanetaryReturn, type PlanetaryReturnData } from '../domain/planetary-return.js';
import { composeFallbackText } from '../interpretation/compose.js';
import type { StationEvent } from '../astrology/stations.js';
import type { TransitAspectEvent } from '../astrology/transit-events.js';
import { civilFromJulianDay } from '../time/julian.js';
import { todayInputValue } from './format.js';
import { useMessages } from './messages.js';
import { momentKey } from '../time/encode.js';
import { useLocale } from './locale.js';
import { periodicTransitViewMessages } from './PeriodicTransitView.messages.js';
import { PersonNotFound } from './PersonNotFound.js';
import { SortableTable } from './SortableTable.js';
import { useStoreState } from './store-context.js';
import type { TableColumn } from './table-sort.js';
import type { BodyId, JulianDayUT } from '../ephemeris/types.js';
import type { CorpusPlacement, Locale } from '../interpretation/schema.js';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: PeriodicTransitForecast }
  | { readonly kind: 'error'; readonly message: string };

/**
 * The outer/social/personal planets a practitioner actually asks about for a return — unlike
 * solar/lunar, which already have their own always-on tiers above. Independent `Load` and effect
 * from the combined forecast above: this is the only tier driven by a user pick rather than
 * always-on, and that pick has to drive its own fetch rather than the combined one.
 */
const RETURN_BODY_KEYS = ['jupiter', 'saturn', 'mars', 'venus', 'mercury'] as const;
type ReturnBodyKey = (typeof RETURN_BODY_KEYS)[number];

type PlanetaryReturnLoad =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: PlanetaryReturnData }
  | { readonly kind: 'error'; readonly message: string };

/** UTC civil date and time, to the minute — every timestamp here is a computed UT moment, not a local one. */
function formatUtc(jd: JulianDayUT): string {
  const civil = civilFromJulianDay(jd);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(civil.year)}-${pad(civil.month)}-${pad(civil.day)} ${pad(civil.hour)}:${pad(civil.minute)} UT`;
}

function bodyKey(body: BodyId): string {
  return bodyById(body)?.key ?? String(body);
}

function bodyName(body: BodyId, locale: Locale): string {
  return bodyDisplayName(bodyKey(body), locale);
}

/** The `transit-aspect` fallback sentence (see file doc) for one transiting/natal pair. `composeFallbackText` already composes this mechanically in either locale — no corpus content needed. */
function transitAspectSentence(transiting: BodyId, natal: BodyId, aspectKey: string, locale: Locale): string {
  const placement: CorpusPlacement = {
    category: 'transit-aspect',
    aspect: aspectKey,
    transiting: bodyKey(transiting),
    natal: bodyKey(natal),
  };
  return composeFallbackText(placement, locale);
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

function contactRows(aspects: readonly Aspect[], locale: Locale): readonly ContactRow[] {
  return aspects.map((aspect, index) => ({
    key: `${String(aspect.bodyA)}-${aspect.aspect.key}-${String(aspect.bodyB)}-${String(index)}`,
    sentence: transitAspectSentence(aspect.bodyA, aspect.bodyB, aspect.aspect.key, locale),
    transiting: bodyName(aspect.bodyA, locale),
    aspect: aspect.aspect.name,
    natal: bodyName(aspect.bodyB, locale),
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
  locale: Locale,
): readonly ExactEventRow[] {
  return events.map((event, index) => ({
    key: `${String(event.jd)}-${String(event.transitingBody)}-${String(event.natalBody)}-${String(index)}`,
    jd: event.jd,
    date: formatUtc(event.jd),
    sentence:
      transitAspectSentence(event.transitingBody, event.natalBody, event.aspect.key, locale) +
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
  locale: Locale,
): readonly StationRow[] {
  return stations.map((station, index) => ({
    key: `${String(station.jd)}-${String(station.body)}-${String(index)}`,
    jd: station.jd,
    date: formatUtc(station.jd),
    body: bodyName(station.body, locale),
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

function localizedSignName(sign: number, locale: Locale, t: typeof periodicTransitViewMessages.en): string {
  const name = SIGNS[sign]?.name;
  return name !== undefined ? signDisplayName(name, locale) : t.signFallback(String(sign));
}

function signHouseLabel(sign: number, house: number, locale: Locale, t: typeof periodicTransitViewMessages.en): string {
  return `${localizedSignName(sign, locale, t)}${t.houseSuffix(house)}`;
}

export function PeriodicTransitView({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);
  const t = useMessages(periodicTransitViewMessages);
  const [locale] = useLocale();
  const [asOf, setAsOf] = useState(todayInputValue);
  const { provider } = useEphemerisProvider();
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

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
  }, [momentKey(person?.moment), provider, targetDate]);

  const [returnBodyKey, setReturnBodyKey] = useState<ReturnBodyKey>('jupiter');
  const [returnLoad, setReturnLoad] = useState<PlanetaryReturnLoad>({ kind: 'idle' });

  useEffect(() => {
    if (person?.moment === undefined || provider === undefined || targetDate === undefined) {
      setReturnLoad({ kind: 'idle' });
      return undefined;
    }
    const moment = person.moment;
    const body = bodyByKey(returnBodyKey);
    if (body === undefined) {
      setReturnLoad({ kind: 'idle' });
      return undefined;
    }
    const effect = { cancelled: false };
    setReturnLoad({ kind: 'loading' });

    void (async () => {
      try {
        const searchFromJd = await provider.julianDayFromUtc(
          targetDate.year,
          targetDate.month,
          targetDate.day,
          12,
          0,
          0,
        );
        const data = await computePlanetaryReturn(moment, body.id, searchFromJd, provider);
        if (!effect.cancelled) setReturnLoad({ kind: 'ready', data });
      } catch (error) {
        if (!effect.cancelled)
          setReturnLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      effect.cancelled = true;
    };
  }, [momentKey(person?.moment), provider, targetDate, returnBodyKey]);

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
  const demibirthdayAscendantSign =
    data !== undefined ? Math.floor((data.yearly.demibirthday.houses.cusps[1] ?? 0) / 30) : 0;
  const progressedLunarReturnAscendantSign =
    data !== undefined ? Math.floor((data.monthly.progressedLunarReturn.houses.cusps[1] ?? 0) / 30) : 0;
  const returnData = returnLoad.kind === 'ready' ? returnLoad.data : undefined;
  const planetaryReturnAscendantSign =
    returnData !== undefined ? Math.floor((returnData.houses.cusps[1] ?? 0) / 30) : 0;

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
              {t.moonInLabel} {signHouseLabel(data.daily.moon.sign, data.daily.moon.house, locale, t)}
              {data.daily.moon.position.retrograde ? ` ${t.retrograde}` : ''}.
            </p>
            {data.daily.moonAspects.length > 0 && (
              <SortableTable
                caption={t.moonAspectsCaption}
                columns={contactColumns(t)}
                rows={contactRows(data.daily.moonAspects, locale)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-daily-moon', 'csv')}
              />
            )}
            {data.daily.exactToday.length > 0 && (
              <SortableTable
                caption={t.exactTodayCaption}
                columns={exactEventColumns(t)}
                rows={exactEventRows(data.daily.exactToday, t, locale)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-daily-exact', 'csv')}
              />
            )}
            {data.daily.stationsToday.length > 0 && (
              <SortableTable
                caption={t.stationsTodayCaption}
                columns={stationColumns(t)}
                rows={stationRows(data.daily.stationsToday, t, locale)}
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
                rows={exactEventRows(data.weekly.events, t, locale)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-weekly', 'csv')}
              />
            ) : (
              <p>{t.noAspectsWeek}</p>
            )}
            {data.weekly.lunarReturns.returns.length > 0 ? (
              data.weekly.lunarReturns.returns.map((lunarReturn, index) => {
                const ascendantSign = Math.floor((lunarReturn.houses.cusps[1] ?? 0) / 30);
                return (
                  <div key={`${String(lunarReturn.returnJd)}-${String(index)}`}>
                    <p>
                      {t.lunarReturnSentence(
                        formatUtc(lunarReturn.returnJd),
                        localizedSignName(ascendantSign, locale, t),
                      )}
                    </p>
                    {lunarReturn.contacts.length > 0 && (
                      <SortableTable
                        caption={t.lunarReturnContactsCaption}
                        columns={contactColumns(t)}
                        rows={contactRows(lunarReturn.contacts, locale)}
                        getRowKey={(row) => row.key}
                        downloadFilename={deriveExportFilename(
                          person.displayName,
                          `forecast-weekly-lunar-return-${String(index)}`,
                          'csv',
                        )}
                      />
                    )}
                  </div>
                );
              })
            ) : (
              <p>{t.noLunarReturnWeek}</p>
            )}
          </section>

          <section>
            <h2>{t.monthlyHeading}</h2>
            <p>
              {t.sunInThisMonth(
                signHouseLabel(data.monthly.sun.sign, data.monthly.sun.house, locale, t),
                formatUtc(data.monthly.fromJd),
                formatUtc(data.monthly.toJd),
              )}
            </p>
            {data.monthly.events.length > 0 ? (
              <SortableTable
                caption={t.exactThisMonthCaption}
                columns={exactEventColumns(t)}
                rows={exactEventRows(data.monthly.events, t, locale)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-monthly', 'csv')}
              />
            ) : (
              <p>{t.noAspectsMonth}</p>
            )}
            <p>
              {t.progressedLunarReturnSentence(
                formatUtc(data.monthly.progressedLunarReturn.returnJd),
                localizedSignName(progressedLunarReturnAscendantSign, locale, t),
              )}
            </p>
            {data.monthly.progressedLunarReturn.contacts.length > 0 && (
              <SortableTable
                caption={t.progressedLunarReturnContactsCaption}
                columns={contactColumns(t)}
                rows={contactRows(data.monthly.progressedLunarReturn.contacts, locale)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(
                  person.displayName,
                  'forecast-monthly-progressed-lunar-return',
                  'csv',
                )}
              />
            )}
          </section>

          <section>
            <h2>{t.yearlyHeading}</h2>
            <p>
              {t.solarReturnSentence(
                String(data.yearly.solarReturn.year),
                formatUtc(data.yearly.solarReturn.returnJd),
                localizedSignName(returnAscendantSign, locale, t),
              )}
            </p>
            {data.yearly.solarReturn.contacts.length > 0 && (
              <SortableTable
                caption={t.solarReturnContactsCaption}
                columns={contactColumns(t)}
                rows={contactRows(data.yearly.solarReturn.contacts, locale)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-yearly-return', 'csv')}
              />
            )}
            <p>
              {t.demibirthdaySentence(
                String(data.yearly.demibirthday.year),
                formatUtc(data.yearly.demibirthday.demibirthdayJd),
                localizedSignName(demibirthdayAscendantSign, locale, t),
              )}
            </p>
            {data.yearly.demibirthday.contacts.length > 0 && (
              <SortableTable
                caption={t.demibirthdayContactsCaption}
                columns={contactColumns(t)}
                rows={contactRows(data.yearly.demibirthday.contacts, locale)}
                getRowKey={(row) => row.key}
                downloadFilename={deriveExportFilename(person.displayName, 'forecast-yearly-demibirthday', 'csv')}
              />
            )}
          </section>

          <section>
            <h2>{t.planetaryReturnHeading}</h2>
            <p className="hint">{t.planetaryReturnHint}</p>
            <p>
              <label>
                {t.bodyLabel}{' '}
                <select
                  value={returnBodyKey}
                  onChange={(event) => {
                    setReturnBodyKey(event.target.value as ReturnBodyKey);
                  }}
                >
                  {RETURN_BODY_KEYS.map((key) => (
                    <option key={key} value={key}>
                      {bodyDisplayName(key, locale)}
                    </option>
                  ))}
                </select>
              </label>
            </p>

            {returnLoad.kind === 'loading' && <p className="status">{t.calculating}</p>}
            {returnLoad.kind === 'error' && (
              <p className="warning" role="alert">
                {t.error(returnLoad.message)}
              </p>
            )}
            {returnData !== undefined && (
              <>
                <p>
                  {t.planetaryReturnSentence(
                    bodyDisplayName(returnBodyKey, locale),
                    formatUtc(returnData.returnJd),
                    localizedSignName(planetaryReturnAscendantSign, locale, t),
                  )}
                </p>
                {returnData.contacts.length > 0 && (
                  <SortableTable
                    caption={t.planetaryReturnContactsCaption}
                    columns={contactColumns(t)}
                    rows={contactRows(returnData.contacts, locale)}
                    getRowKey={(row) => row.key}
                    downloadFilename={deriveExportFilename(person.displayName, 'forecast-planetary-return', 'csv')}
                  />
                )}
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
