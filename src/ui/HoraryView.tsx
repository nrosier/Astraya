/**
 * Horary chart (#406): a chart cast for the moment and place a question was asked, with the
 * traditional considerations before judgment checked against it. Needs no saved person and no
 * stored data — like the shared-chart screen it is computed entirely in this browser — so it lives
 * outside `Stored`. The chart itself is the same `ChartDataView` every other chart uses.
 *
 * It says whether the chart is fit to be judged and nothing more: reading the answer to the
 * question is the astrologer's work.
 */
import { useState } from 'react';
import { isRadical } from '../astrology/horary.js';
import { chartSheetMetaLines } from '../domain/chart-tables.js';
import { computeHoraryChart, HORARY_DEFAULT_HOUSE_SYSTEM, type HoraryChart } from '../domain/horary.js';
import { BirthPlaceSearch } from './BirthPlaceSearch.js';
import { ChartDataView } from './ChartView.js';
import { useEphemerisProvider } from './EphemerisProviderContext.js';
import { HORARY_HOUSE_SYSTEMS, nowFields, parseHoraryFields, type HoraryFieldError } from './horary.js';
import { horaryViewMessages } from './HoraryView.messages.js';
import { useLocale } from './locale.js';
import { useMessages } from './messages.js';
import { sharedMessages } from './shared.messages.js';
import { transitViewMessages } from './TransitView.messages.js';
import { voidOfCourseSentence } from './void-of-course-text.js';
import type { BirthMomentInput } from '../time/types.js';

type Result =
  | { readonly kind: 'idle' }
  | { readonly kind: 'casting' }
  | { readonly kind: 'ready'; readonly chart: HoraryChart; readonly moment: BirthMomentInput }
  | { readonly kind: 'error'; readonly message: string };

export function HoraryView(): React.JSX.Element {
  const t = useMessages(horaryViewMessages);
  const transit = useMessages(transitViewMessages);
  const shared = useMessages(sharedMessages);
  const [locale] = useLocale();
  const { provider } = useEphemerisProvider();
  const [fields, setFields] = useState(() => ({ ...nowFields(), latitude: '', longitude: '' }));
  const [houseSystem, setHouseSystem] = useState(HORARY_DEFAULT_HOUSE_SYSTEM);
  const [fieldError, setFieldError] = useState<HoraryFieldError>();
  const [result, setResult] = useState<Result>({ kind: 'idle' });

  const cast = (): void => {
    if (provider === undefined) return;
    const parsed = parseHoraryFields(fields);
    if (!parsed.ok) {
      setFieldError(parsed.field);
      return;
    }
    setFieldError(undefined);
    setResult({ kind: 'casting' });
    void computeHoraryChart(parsed.moment, provider, houseSystem).then(
      (chart) => {
        setResult({ kind: 'ready', chart, moment: parsed.moment });
      },
      (error: unknown) => {
        setResult({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      },
    );
  };

  const edit = (patch: Partial<typeof fields>): void => {
    setFields((current) => ({ ...current, ...patch }));
  };

  const ready = result.kind === 'ready' ? result : undefined;

  return (
    <main className="shell">
      <p className="back">
        <a href="#/">&larr; {shared.back}</a>
      </p>
      <h1>{t.heading}</h1>
      <p className="hint">{t.hint}</p>

      <div className="field-grid">
        <label>
          {t.dateLabel}
          <input
            type="date"
            value={fields.date}
            onChange={(event) => {
              edit({ date: event.target.value });
            }}
          />
        </label>
        <label>
          {t.timeLabel}
          <input
            type="time"
            value={fields.time}
            onChange={(event) => {
              edit({ time: event.target.value });
            }}
          />
        </label>
        <label>
          {t.latitudeLabel}
          <input
            type="text"
            inputMode="decimal"
            value={fields.latitude}
            onChange={(event) => {
              edit({ latitude: event.target.value });
            }}
          />
        </label>
        <label>
          {t.longitudeLabel}
          <input
            type="text"
            inputMode="decimal"
            value={fields.longitude}
            onChange={(event) => {
              edit({ longitude: event.target.value });
            }}
          />
        </label>
        <label>
          {t.houseSystemLabel}
          <select
            value={houseSystem}
            onChange={(event) => {
              setHouseSystem(event.target.value);
            }}
          >
            {HORARY_HOUSE_SYSTEMS.map((code) => (
              <option key={code} value={code}>
                {t.houseSystems[code] ?? code}
              </option>
            ))}
          </select>
        </label>
      </div>

      <BirthPlaceSearch
        onPick={(latitude, longitude) => {
          edit({ latitude: String(latitude), longitude: String(longitude) });
        }}
      />

      <p>
        <button type="button" disabled={provider === undefined || result.kind === 'casting'} onClick={cast}>
          {result.kind === 'casting' ? t.casting : t.castButton}
        </button>
      </p>

      {fieldError !== undefined && (
        <p className="warning" role="alert">
          {t.fieldErrors[fieldError]}
        </p>
      )}
      {result.kind === 'error' && (
        <p className="warning" role="alert">
          {t.error(result.message)}
        </p>
      )}

      {ready !== undefined && (
        <>
          <h2>{t.considerationsHeading}</h2>
          {/* Every consideration is a verdict on this chart, so none exists before one is cast. */}
          {!ready.chart.housesAvailable && <p className="warning">{t.noHouses}</p>}
          <p className={isRadical(ready.chart.considerations) ? 'horary-verdict' : 'horary-verdict warning'}>
            {isRadical(ready.chart.considerations)
              ? t.radical
              : t.notRadical(ready.chart.considerations.filter((consideration) => consideration.applies).length)}
          </p>
          <ul className="horary-considerations">
            {ready.chart.considerations.map((consideration) => {
              const copy = t.considerations[consideration.key];
              return (
                <li key={consideration.key} className={consideration.applies ? 'applies' : 'clear'}>
                  <strong>{copy?.label ?? consideration.key}</strong>
                  {' — '}
                  <span className="horary-status">{consideration.applies ? t.applies : t.clear}</span>
                  <br />
                  <span className="hint">{copy?.explanation}</span>
                </li>
              );
            })}
          </ul>
          <p className="hint">{voidOfCourseSentence(ready.chart.voidOfCourse, transit, locale)}</p>

          <ChartDataView
            load={{ kind: 'ready', data: ready.chart.data }}
            displayName={t.chartName}
            showHouses={ready.chart.housesAvailable}
            metaLines={chartSheetMetaLines(t.chartName, ready.moment, locale)}
          />
        </>
      )}
    </main>
  );
}
