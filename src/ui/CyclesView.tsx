/**
 * Planetary cycles (#410): the exact aspects between two moving bodies over a span of years,
 * as a table and as a diagram of where each falls on the zodiac. Independent of any person or
 * stored data — it needs only the ephemeris — so it lives outside `Stored`, like `AdminPanel`.
 *
 * The diagram is app-generated from just-computed longitudes, never user-supplied markup, and
 * is hidden from assistive tech: the table beside it carries every value it plots.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { findMutualAspects, type MutualAspectEvent } from '../astrology/mutual-aspects.js';
import { renderCycleDiagramSvg } from '../chart/cycle-diagram.js';
import { aspectDisplayName, bodyDisplayName, signDisplayName } from './astro-names.messages.js';
import {
  bodyIdOf,
  CYCLE_ASPECT_KEYS,
  CYCLE_BODY_KEYS,
  CYCLE_PRESETS,
  cycleRows,
  filterByMotion,
  type CyclePreset,
  type CycleRow,
  type MotionFilter,
} from './cycles.js';
import { cyclesViewMessages } from './CyclesView.messages.js';
import { useEphemerisProvider } from './EphemerisProviderContext.js';
import { useLocale } from './locale.js';
import { useMessages } from './messages.js';
import { sharedMessages } from './shared.messages.js';
import { SortableTable } from './SortableTable.js';
import { clampEphemerisYear, MAX_EPHEMERIS_YEAR, MIN_EPHEMERIS_YEAR } from './year-range.js';
import type { TableColumn } from './table-sort.js';

interface Params {
  readonly bodyA: string;
  readonly bodyB: string;
  readonly aspect: string;
  readonly motion: MotionFilter;
  readonly fromYear: string;
  readonly toYear: string;
}

type Result =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly rows: readonly CycleRow[]; readonly params: Params }
  | { readonly kind: 'error'; readonly message: string };

function paramsFor(preset: CyclePreset): Params {
  const thisYear = new Date().getUTCFullYear();
  const span =
    'yearsFromNow' in preset.span
      ? { from: thisYear, to: Math.ceil(thisYear + preset.span.yearsFromNow) }
      : preset.span;
  return {
    bodyA: preset.bodyA,
    bodyB: preset.bodyB,
    aspect: preset.aspect,
    motion: preset.motion,
    fromYear: String(span.from),
    toYear: String(span.to),
  };
}

export function CyclesView(): React.JSX.Element {
  const t = useMessages(cyclesViewMessages);
  const shared = useMessages(sharedMessages);
  const [locale] = useLocale();
  const { provider } = useEphemerisProvider();
  const first = CYCLE_PRESETS[0];
  const [presetKey, setPresetKey] = useState<string>(first?.key ?? 'custom');
  const [params, setParams] = useState<Params>(
    first === undefined
      ? { bodyA: 'jupiter', bodyB: 'saturn', aspect: 'conjunction', motion: 'all', fromYear: '1800', toYear: '2200' }
      : paramsFor(first),
  );
  const [validation, setValidation] = useState<string>();
  const [result, setResult] = useState<Result>({ kind: 'idle' });
  const runId = useRef(0);

  const run = (next: Params): void => {
    if (provider === undefined) return;
    setValidation(undefined);
    const idA = bodyIdOf(next.bodyA);
    const idB = bodyIdOf(next.bodyB);
    const from = clampEphemerisYear(next.fromYear);
    const to = clampEphemerisYear(next.toYear);
    if (idA === undefined || idB === undefined || next.bodyA === next.bodyB) {
      setValidation(t.needsTwoBodies);
      return;
    }
    if (from === undefined || to === undefined) {
      setValidation(t.badYear(MIN_EPHEMERIS_YEAR, MAX_EPHEMERIS_YEAR));
      return;
    }
    if (to < from) {
      setValidation(t.yearsReversed);
      return;
    }
    const id = ++runId.current;
    setResult({ kind: 'loading' });
    void (async () => {
      try {
        const fromJd = await provider.julianDayFromUtc(from, 1, 1, 0, 0, 0);
        const toJd = await provider.julianDayFromUtc(to + 1, 1, 1, 0, 0, 0);
        const events: readonly MutualAspectEvent[] = await findMutualAspects(provider, idA, idB, fromJd, toJd, {
          aspectKeys: [next.aspect],
          bodyKeys: [next.bodyA, next.bodyB],
        });
        if (id !== runId.current) return;
        setResult({
          kind: 'ready',
          rows: cycleRows(filterByMotion(events, next.motion)),
          params: { ...next, fromYear: String(from), toYear: String(to) },
        });
      } catch (error) {
        if (id === runId.current) {
          setResult({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
  };

  // The first preset is searched as soon as the ephemeris is ready, so the screen opens on a result.
  const started = useRef(false);
  useEffect(() => {
    if (provider === undefined || started.current) return;
    started.current = true;
    run(params);
    // Only when the provider first appears.
  }, [provider]);

  const choosePreset = (key: string): void => {
    setPresetKey(key);
    const preset = CYCLE_PRESETS.find((candidate) => candidate.key === key);
    if (preset === undefined) return;
    const next = paramsFor(preset);
    setParams(next);
    run(next);
  };

  const edit = (patch: Partial<Params>): void => {
    setPresetKey('custom');
    setParams((current) => ({ ...current, ...patch }));
  };

  const nameOf = (key: string): string => bodyDisplayName(key, locale);

  const columns = useMemo<readonly TableColumn<CycleRow>[]>(
    () => [
      { key: 'date', label: t.dateColumn, valueOf: (row) => row.jd, render: (row) => row.date },
      {
        key: 'aspect',
        label: t.aspectColumn,
        valueOf: (row) => row.aspectKey,
        render: (row) => aspectDisplayName(row.aspectKey, locale),
      },
      {
        key: 'position',
        label: t.positionColumn,
        valueOf: (row) => row.longitude,
        render: (row) => `${signDisplayName(row.signName, locale)} ${row.position}`,
      },
      {
        key: 'retrograde',
        label: t.retrogradeColumn,
        valueOf: (row) => Number(row.retrogradeA) + Number(row.retrogradeB),
        render: (row) => {
          if (result.kind !== 'ready') return t.none;
          const names = [
            row.retrogradeA ? nameOf(result.params.bodyA) : undefined,
            row.retrogradeB ? nameOf(result.params.bodyB) : undefined,
          ].filter((name): name is string => name !== undefined);
          return names.length === 0 ? t.none : names.join(', ');
        },
      },
      {
        key: 'since',
        label: t.sinceColumn,
        valueOf: (row) => row.yearsSincePrevious ?? '',
        render: (row) => (row.yearsSincePrevious === undefined ? t.none : row.yearsSincePrevious.toFixed(2)),
      },
    ],
    // `nameOf` closes over `locale`, which is listed.
    [t, locale, result],
  );

  const diagram = useMemo(
    () =>
      result.kind === 'ready' && result.rows.length > 0
        ? renderCycleDiagramSvg(
            result.rows.map((row, index) => ({ longitude: row.longitude, label: String(index + 1) })),
          )
        : undefined,
    [result],
  );

  return (
    <main className="shell">
      <p className="back">
        <a href="#/">&larr; {shared.back}</a>
      </p>
      <h1>{t.heading}</h1>
      <p className="hint">{t.hint}</p>

      <div className="field-grid cycles-form">
        <label>
          {t.presetLabel}
          <select
            value={presetKey}
            onChange={(event) => {
              choosePreset(event.target.value);
            }}
          >
            <option value="custom">{t.presetCustom}</option>
            {CYCLE_PRESETS.map((preset) => (
              <option key={preset.key} value={preset.key}>
                {t.presets[preset.key] ?? preset.key}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.bodyALabel}
          <select
            value={params.bodyA}
            onChange={(event) => {
              edit({ bodyA: event.target.value });
            }}
          >
            {CYCLE_BODY_KEYS.map((key) => (
              <option key={key} value={key}>
                {nameOf(key)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.bodyBLabel}
          <select
            value={params.bodyB}
            onChange={(event) => {
              edit({ bodyB: event.target.value });
            }}
          >
            {CYCLE_BODY_KEYS.map((key) => (
              <option key={key} value={key}>
                {nameOf(key)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.aspectLabel}
          <select
            value={params.aspect}
            onChange={(event) => {
              edit({ aspect: event.target.value });
            }}
          >
            {CYCLE_ASPECT_KEYS.map((key) => (
              <option key={key} value={key}>
                {aspectDisplayName(key, locale)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.motionLabel}
          <select
            value={params.motion}
            onChange={(event) => {
              edit({ motion: event.target.value as MotionFilter });
            }}
          >
            <option value="all">{t.motionAll}</option>
            <option value="retrograde">{t.motionRetrograde}</option>
            <option value="direct">{t.motionDirect}</option>
          </select>
        </label>
        <label>
          {t.fromYearLabel}
          <input
            type="text"
            inputMode="numeric"
            value={params.fromYear}
            onChange={(event) => {
              edit({ fromYear: event.target.value });
            }}
          />
        </label>
        <label>
          {t.toYearLabel}
          <input
            type="text"
            inputMode="numeric"
            value={params.toYear}
            onChange={(event) => {
              edit({ toYear: event.target.value });
            }}
          />
        </label>
      </div>
      <p>
        <button
          type="button"
          disabled={provider === undefined || result.kind === 'loading'}
          onClick={() => {
            run(params);
          }}
        >
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
          <p className="hint">{t.noEvents}</p>
        ) : (
          <>
            <p>
              {t.summary(
                result.rows.length,
                nameOf(result.params.bodyA),
                nameOf(result.params.bodyB),
                Number(result.params.fromYear),
                Number(result.params.toYear),
              )}
            </p>
            {diagram !== undefined && (
              <figure className="cycle-figure">
                <div aria-hidden="true" dangerouslySetInnerHTML={{ __html: diagram }} />
                <figcaption className="hint">{t.diagramCaption}</figcaption>
              </figure>
            )}
            <SortableTable
              caption={t.tableCaption}
              columns={columns}
              rows={result.rows}
              getRowKey={(row) => String(row.jd)}
              downloadFilename={`cycles-${result.params.bodyA}-${result.params.bodyB}-${result.params.aspect}.csv`}
            />
          </>
        ))}
    </main>
  );
}
