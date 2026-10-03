/**
 * Electional search (#409): the best stretches of a span of days to begin something, ranked by
 * how many of the chosen traditional rules hold. Computed entirely in this browser from the
 * ephemeris, with no saved person and no stored data, so it lives outside `Stored`.
 *
 * It says which times fit the rules; whether to act then is the user's judgment.
 */
import { useMemo, useRef, useState } from 'react';
import { ELECTION_RULE_KEYS, findElectionWindows, type ElectionRuleKey } from '../astrology/electional.js';
import { BirthPlaceSearch } from './BirthPlaceSearch.js';
import {
  ELECTION_STEP_MINUTES,
  electionRows,
  MAX_ELECTION_SPAN_DAYS,
  parseElectionFields,
  type ElectionFieldError,
  type ElectionRow,
} from './electional.js';
import { electionalViewMessages } from './ElectionalView.messages.js';
import { useEphemerisProvider } from './EphemerisProviderContext.js';
import { todayInputValue } from './format.js';
import { useMessages } from './messages.js';
import { sharedMessages } from './shared.messages.js';
import { SortableTable } from './SortableTable.js';
import type { TableColumn } from './table-sort.js';

type Result =
  | { readonly kind: 'idle' }
  | { readonly kind: 'searching' }
  | { readonly kind: 'ready'; readonly rows: readonly ElectionRow[]; readonly enabled: number }
  | { readonly kind: 'error'; readonly message: string };

/** The date `days` after today, as `YYYY-MM-DD`. */
function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function ElectionalView(): React.JSX.Element {
  const t = useMessages(electionalViewMessages);
  const shared = useMessages(sharedMessages);
  const { provider } = useEphemerisProvider();
  const [fields, setFields] = useState({ fromDate: todayInputValue(), toDate: inDays(6), latitude: '', longitude: '' });
  const [rules, setRules] = useState<ReadonlySet<ElectionRuleKey>>(() => new Set(ELECTION_RULE_KEYS));
  const [stepMinutes, setStepMinutes] = useState(60);
  const [fieldError, setFieldError] = useState<ElectionFieldError>();
  const [result, setResult] = useState<Result>({ kind: 'idle' });
  const runId = useRef(0);

  const edit = (patch: Partial<typeof fields>): void => {
    setFields((current) => ({ ...current, ...patch }));
  };

  const toggleRule = (key: ElectionRuleKey): void => {
    setRules((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const search = (): void => {
    if (provider === undefined) return;
    const parsed = parseElectionFields({ ...fields, rules });
    if (!parsed.ok) {
      setFieldError(parsed.error);
      return;
    }
    setFieldError(undefined);
    const id = ++runId.current;
    setResult({ kind: 'searching' });
    const { from, to, place, rules: enabled } = parsed.search;
    void (async () => {
      try {
        const fromJd = await provider.julianDayFromUtc(from.year, from.month, from.day, 0, 0, 0);
        const toJd = await provider.julianDayFromUtc(to.year, to.month, to.day, 0, 0, 0);
        const windows = await findElectionWindows(provider, place, fromJd, toJd - 1 / 1440, enabled, {
          stepMinutes,
        });
        if (id === runId.current) setResult({ kind: 'ready', rows: electionRows(windows), enabled: enabled.size });
      } catch (error) {
        if (id === runId.current) {
          setResult({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
  };

  const ruleLabels = (keys: readonly ElectionRuleKey[]): string =>
    keys.length === 0 ? t.none : keys.map((key) => t.rules[key]?.label ?? key).join('; ');

  const columns = useMemo<readonly TableColumn<ElectionRow>[]>(
    () => [
      { key: 'start', label: t.startColumn, valueOf: (row) => row.startJd, render: (row) => row.start },
      { key: 'end', label: t.endColumn, valueOf: (row) => row.endJd, render: (row) => row.end },
      {
        key: 'duration',
        label: t.durationColumn,
        valueOf: (row) => row.endJd - row.startJd,
        render: (row) => row.duration,
      },
      {
        key: 'score',
        label: t.scoreColumn,
        valueOf: (row) => row.satisfied.length,
        render: (row) => t.score(row.satisfied.length, row.satisfied.length + row.violated.length),
      },
      {
        key: 'satisfied',
        label: t.satisfiedColumn,
        valueOf: (row) => row.satisfied.length,
        render: (row) => ruleLabels(row.satisfied),
      },
      {
        key: 'violated',
        label: t.violatedColumn,
        valueOf: (row) => row.violated.length,
        render: (row) => ruleLabels(row.violated),
      },
    ],
    // `ruleLabels` reads `t`, which is listed.
    [t],
  );

  const errorText = (error: ElectionFieldError): string =>
    error === 'span' ? t.fieldErrors.span(MAX_ELECTION_SPAN_DAYS) : t.fieldErrors[error];

  return (
    <main className="shell">
      <p className="back">
        <a href="#/">&larr; {shared.back}</a>
      </p>
      <h1>{t.heading}</h1>
      <p className="hint">{t.hint}</p>

      <div className="field-grid">
        <label>
          {t.fromDateLabel}
          <input
            type="date"
            value={fields.fromDate}
            onChange={(event) => {
              edit({ fromDate: event.target.value });
            }}
          />
        </label>
        <label>
          {t.toDateLabel}
          <input
            type="date"
            value={fields.toDate}
            onChange={(event) => {
              edit({ toDate: event.target.value });
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
          {t.stepLabel}
          <select
            value={stepMinutes}
            onChange={(event) => {
              setStepMinutes(Number(event.target.value));
            }}
          >
            {ELECTION_STEP_MINUTES.map((minutes) => (
              <option key={minutes} value={minutes}>
                {t.stepOption(minutes)}
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

      <fieldset className="field-group">
        <legend>{t.rulesLegend}</legend>
        <ul className="election-rules">
          {ELECTION_RULE_KEYS.map((key) => (
            <li key={key}>
              <label>
                <input
                  type="checkbox"
                  checked={rules.has(key)}
                  onChange={() => {
                    toggleRule(key);
                  }}
                />{' '}
                <strong>{t.rules[key]?.label ?? key}</strong>
                <br />
                <span className="hint">{t.rules[key]?.explanation}</span>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <p>
        <button type="button" disabled={provider === undefined || result.kind === 'searching'} onClick={search}>
          {result.kind === 'searching' ? t.finding : t.findButton}
        </button>
      </p>

      {fieldError !== undefined && (
        <p className="warning" role="alert">
          {errorText(fieldError)}
        </p>
      )}
      {result.kind === 'error' && (
        <p className="warning" role="alert">
          {t.error(result.message)}
        </p>
      )}

      {result.kind === 'ready' &&
        (result.rows.length === 0 ? (
          <p className="hint">{t.noWindows}</p>
        ) : (
          <>
            <p>{t.summary(result.rows.length, result.enabled)}</p>
            <SortableTable
              caption={t.tableCaption}
              columns={columns}
              rows={result.rows}
              getRowKey={(row) => row.id}
              downloadFilename="electional-windows.csv"
            />
          </>
        ))}
    </main>
  );
}
