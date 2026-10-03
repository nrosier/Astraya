/**
 * Eclipses (#404): the solar and lunar eclipses in a span of years, each placed in the zodiac,
 * and — for a chosen person — which of their natal points each one touches. Lives inside
 * `Stored` because the person list comes from the local store; the search itself needs only the
 * ephemeris.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { bodyById } from '../astrology/bodies.js';
import { eclipseContacts, findEclipses, type Eclipse, type NatalPoint } from '../astrology/eclipses.js';
import { computeChartData } from '../domain/chart-compute.js';
import { ordered } from './people-list.js';
import { aspectDisplayName, bodyDisplayName, signDisplayName } from './astro-names.messages.js';
import { eclipseRows, MAX_ECLIPSE_SPAN_YEARS, type EclipseRow } from './eclipses.js';
import { eclipsesViewMessages } from './EclipsesView.messages.js';
import { useEphemerisProvider } from './EphemerisProviderContext.js';
import { useLocale } from './locale.js';
import { useMessages } from './messages.js';
import { sharedMessages } from './shared.messages.js';
import { SortableTable } from './SortableTable.js';
import { useStoreState } from './store-context.js';
import type { TableColumn } from './table-sort.js';
import { clampEphemerisYear, MAX_EPHEMERIS_YEAR, MIN_EPHEMERIS_YEAR } from './year-range.js';

type Result =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly rows: readonly EclipseRow[];
      readonly fromYear: number;
      readonly toYear: number;
      /** Set when a person was chosen but their ASC/MC had to be left out. */
      readonly anglesLeftOut: boolean;
    }
  | { readonly kind: 'error'; readonly message: string };

export function EclipsesView(): React.JSX.Element {
  const t = useMessages(eclipsesViewMessages);
  const shared = useMessages(sharedMessages);
  const [locale] = useLocale();
  const state = useStoreState();
  const { provider } = useEphemerisProvider();
  const thisYear = new Date().getUTCFullYear();
  const [fromYear, setFromYear] = useState(String(thisYear - 1));
  const [toYear, setToYear] = useState(String(thisYear + 3));
  const [personId, setPersonId] = useState('');
  const [validation, setValidation] = useState<string>();
  const [result, setResult] = useState<Result>({ kind: 'idle' });
  const runId = useRef(0);

  const people = useMemo(() => ordered(state.people), [state.people]);

  const run = (): void => {
    if (provider === undefined) return;
    setValidation(undefined);
    const from = clampEphemerisYear(fromYear);
    const to = clampEphemerisYear(toYear);
    if (from === undefined || to === undefined) {
      setValidation(t.badYear(MIN_EPHEMERIS_YEAR, MAX_EPHEMERIS_YEAR));
      return;
    }
    if (to < from) {
      setValidation(t.yearsReversed);
      return;
    }
    if (to - from + 1 > MAX_ECLIPSE_SPAN_YEARS) {
      setValidation(t.spanTooLong(MAX_ECLIPSE_SPAN_YEARS));
      return;
    }
    const person = personId === '' ? undefined : state.people.get(personId);
    if (personId !== '' && person?.moment === undefined) {
      setValidation(t.noBirthRecord((person?.displayName ?? '') || t.unnamedPerson));
      return;
    }
    const id = ++runId.current;
    setResult({ kind: 'loading' });
    void (async () => {
      try {
        const fromJd = await provider.julianDayFromUtc(from, 1, 1, 0, 0, 0);
        const toJd = await provider.julianDayFromUtc(to + 1, 1, 1, 0, 0, 0);
        const eclipses: readonly Eclipse[] = await findEclipses(provider, fromJd, toJd);

        let points: readonly NatalPoint[] = [];
        let anglesLeftOut = false;
        if (person?.moment !== undefined) {
          const chart = await computeChartData(person.moment, provider);
          const bodies = chart.positions.flatMap((position) => {
            const key = bodyById(position.body)?.key;
            return key === undefined ? [] : [{ key, longitude: position.longitude }];
          });
          // An unknown birth time makes the Ascendant and Midheaven meaningless, not approximate.
          anglesLeftOut = person.timeAccuracy === 'unknown';
          points = anglesLeftOut
            ? bodies
            : [
                ...bodies,
                { key: 'asc', longitude: chart.houses.ascendant },
                { key: 'mc', longitude: chart.houses.midheaven },
              ];
        }
        if (id !== runId.current) return;
        setResult({
          kind: 'ready',
          rows: eclipseRows(eclipses, (eclipse) => eclipseContacts(eclipse, points)),
          fromYear: from,
          toYear: to,
          anglesLeftOut,
        });
      } catch (error) {
        if (id === runId.current) {
          setResult({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
  };

  // Opens on a result: the default span is searched as soon as the ephemeris is ready.
  const started = useRef(false);
  useEffect(() => {
    if (provider === undefined || started.current) return;
    started.current = true;
    run();
  }, [provider]);

  const typeOf = (row: EclipseRow): string => {
    const family = t.families[row.family];
    const kind =
      row.family === 'solar'
        ? t.solarKinds[row.kind as keyof typeof t.solarKinds]
        : t.lunarKinds[row.kind as keyof typeof t.lunarKinds];
    return `${family} — ${kind.toLowerCase()}`;
  };

  const columns = useMemo<readonly TableColumn<EclipseRow>[]>(
    () => [
      { key: 'date', label: t.dateColumn, valueOf: (row) => row.jd, render: (row) => row.date },
      { key: 'type', label: t.typeColumn, valueOf: (row) => typeOf(row), render: (row) => typeOf(row) },
      {
        key: 'position',
        label: t.positionColumn,
        valueOf: (row) => row.longitude,
        render: (row) => `${signDisplayName(row.signName, locale)} ${row.position}`,
      },
      {
        key: 'contacts',
        label: t.contactsColumn,
        valueOf: (row) => row.contacts.length,
        render: (row) =>
          row.contacts.length === 0
            ? t.none
            : row.contacts
                .map((contact) =>
                  t.contact(
                    bodyDisplayName(contact.pointKey, locale),
                    aspectDisplayName(contact.kind, locale),
                    `${contact.orb.toFixed(1)}°`,
                  ),
                )
                .join('; '),
      },
    ],
    // `typeOf` reads `t`, which is listed.
    [t, locale],
  );

  return (
    <main className="shell">
      <p className="back">
        <a href="#/">&larr; {shared.back}</a>
      </p>
      <h1>{t.heading}</h1>
      <p className="hint">{t.hint}</p>

      <div className="field-grid">
        <label>
          {t.fromYearLabel}
          <input
            type="text"
            inputMode="numeric"
            value={fromYear}
            onChange={(event) => {
              setFromYear(event.target.value);
            }}
          />
        </label>
        <label>
          {t.toYearLabel}
          <input
            type="text"
            inputMode="numeric"
            value={toYear}
            onChange={(event) => {
              setToYear(event.target.value);
            }}
          />
        </label>
        <label>
          {t.personLabel}
          <select
            value={personId}
            onChange={(event) => {
              setPersonId(event.target.value);
            }}
          >
            <option value="">{t.personNone}</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName || t.unnamedPerson}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p>
        <button type="button" disabled={provider === undefined || result.kind === 'loading'} onClick={run}>
          {result.kind === 'loading' ? t.finding : t.findButton}
        </button>
      </p>

      {validation !== undefined && (
        <p className="warning" role="alert">
          {validation}
        </p>
      )}
      {result.kind === 'error' && (
        <p className="warning" role="alert">
          {t.error(result.message)}
        </p>
      )}

      {result.kind === 'ready' &&
        (result.rows.length === 0 ? (
          <p className="hint">{t.noEclipses}</p>
        ) : (
          <>
            <p>{t.summary(result.rows.length, result.fromYear, result.toYear)}</p>
            {result.anglesLeftOut && <p className="hint">{t.anglesNote}</p>}
            <SortableTable
              caption={t.tableCaption}
              columns={columns}
              rows={result.rows}
              getRowKey={(row) => row.id}
              downloadFilename={`eclipses-${String(result.fromYear)}-${String(result.toYear)}.csv`}
            />
          </>
        ))}
    </main>
  );
}
