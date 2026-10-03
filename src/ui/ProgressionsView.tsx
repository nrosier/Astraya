/**
 * Secondary, tertiary and minor progressions for one person (#398), computed as of a chosen
 * date — the technique and, for secondary, the MC method are picked in-screen rather than in
 * the URL, same reasoning `HarmonicView.tsx`'s divisional-chart picker already uses.
 *
 * Progressed houses need a known birth time, same gate `ProfectionsView.tsx` and `ChartView.tsx`
 * already use for anything built on the natal Ascendant.
 *
 * The MC method actually used is always shown, never implied — `progressions.ts`'s own doc
 * comment is explicit that the three methods produce visibly different Ascendants, so silently
 * picking one would misrepresent what the chart means.
 */
import { useEffect, useMemo, useState } from 'react';
import { bodyById } from '../astrology/bodies.js';
import type { ProgressedMcMethod } from '../astrology/progressions.js';
import { aspectDisplayName, bodyDisplayName, signDisplayName } from './astro-names.messages.js';
import { housesAreDefined } from '../domain/chart-compute.js';
import { crossAspectRows, degreeParts, type AspectRow, type DegreeParts } from '../domain/chart-tables.js';
import { deriveExportFilename } from '../domain/export-filename.js';
import { houseOf } from '../astrology/emphasis.js';
import { computeMinorProgression, type MinorProgressionData } from '../domain/minor-progression.js';
import { computeSecondaryProgression, type SecondaryProgressionData } from '../domain/secondary-progression.js';
import { useEphemerisProvider } from './EphemerisProviderContext.js';
import { todayInputValue } from './format.js';
import { useLocale } from './locale.js';
import { useMessages } from './messages.js';
import { momentKey } from '../time/encode.js';
import { PersonNotFound } from './PersonNotFound.js';
import { progressionsViewMessages } from './ProgressionsView.messages.js';
import { SortableTable } from './SortableTable.js';
import { useStoreState } from './store-context.js';
import type { TableColumn } from './table-sort.js';
import type { BodyPosition, HousePositions } from '../ephemeris/types.js';
import type { Locale } from '../interpretation/schema.js';

type Technique = 'secondary' | 'tertiary' | 'minor';

type ProgressionData = SecondaryProgressionData | MinorProgressionData;

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: ProgressionData }
  | { readonly kind: 'error'; readonly message: string };

interface PositionRow extends DegreeParts {
  readonly bodyKey: string;
  readonly bodyName: string;
  readonly house?: number;
}

/** Positions plus, matching `chart-tables.ts`'s `positionRows`'s own `includeAngles` convention, the Ascendant and Midheaven. */
function positionRows(positions: readonly BodyPosition[], houses: HousePositions): readonly PositionRow[] {
  const housesUsable = housesAreDefined(houses);
  const bodyRows = positions.map((position) => {
    const body = bodyById(position.body);
    return {
      bodyKey: body?.key ?? String(position.body),
      bodyName: body?.name ?? String(position.body),
      ...degreeParts(position.longitude),
      ...(housesUsable ? { house: houseOf(position.longitude, houses.cusps) } : {}),
    };
  });
  if (!housesUsable) return bodyRows;
  return [
    ...bodyRows,
    { bodyKey: 'asc', bodyName: 'Ascendant', ...degreeParts(houses.ascendant) },
    { bodyKey: 'mc', bodyName: 'Midheaven', ...degreeParts(houses.midheaven) },
  ];
}

function positionColumns(t: typeof progressionsViewMessages.en, locale: Locale): readonly TableColumn<PositionRow>[] {
  return [
    {
      key: 'bodyName',
      label: t.bodyLabel,
      valueOf: (row) => row.bodyName,
      render: (row) => bodyDisplayName(row.bodyKey, locale),
    },
    {
      key: 'sign',
      label: t.signLabel,
      valueOf: (row) => row.sign,
      render: (row) => signDisplayName(row.sign, locale),
    },
    { key: 'degree', label: t.degLabel, valueOf: (row) => row.degree },
    { key: 'minute', label: t.minLabel, valueOf: (row) => row.minute },
    { key: 'second', label: t.secLabel, valueOf: (row) => row.second },
    {
      key: 'house',
      label: t.houseLabel,
      valueOf: (row) => row.house ?? '',
      render: (row) => (row.house === undefined ? '—' : String(row.house)),
    },
  ];
}

function contactColumns(t: typeof progressionsViewMessages.en, locale: Locale): readonly TableColumn<AspectRow>[] {
  return [
    {
      key: 'bodyAName',
      label: t.bodyALabel,
      valueOf: (row) => row.bodyAName,
      render: (row) => bodyDisplayName(row.bodyAKey, locale),
    },
    {
      key: 'aspect',
      label: t.aspectLabel,
      valueOf: (row) => row.aspect,
      render: (row) => aspectDisplayName(row.aspectKey, locale),
    },
    {
      key: 'bodyBName',
      label: t.bodyBLabel,
      valueOf: (row) => row.bodyBName,
      render: (row) => bodyDisplayName(row.bodyBKey, locale),
    },
    { key: 'orb', label: t.orbLabel, valueOf: (row) => row.orb, render: (row) => `${row.orb.toFixed(2)}°` },
    {
      key: 'applying',
      label: t.applyingLabel,
      valueOf: (row) => row.applying,
      render: (row) => (row.applying ? t.applying : t.separating),
    },
  ];
}

function mcMethodLabel(t: typeof progressionsViewMessages.en, method: ProgressedMcMethod): string {
  switch (method) {
    case 'quotidian':
      return t.quotidianMethod;
    case 'naibod':
      return t.naibodMethod;
    case 'solarArc':
      return t.solarArcMethod;
  }
}

export function ProgressionsView({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);
  const t = useMessages(progressionsViewMessages);
  const [locale] = useLocale();
  const [technique, setTechnique] = useState<Technique>('secondary');
  const [mcMethod, setMcMethod] = useState<ProgressedMcMethod>('naibod');
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
        // Noon, not midnight — same reasoning `ProfectionsView.tsx`'s own "As of" input gives.
        const targetJd = await provider.julianDayFromUtc(targetDate.year, targetDate.month, targetDate.day, 12, 0, 0);
        const data: ProgressionData =
          technique === 'secondary'
            ? await computeSecondaryProgression(moment, targetJd, provider, { mcMethod })
            : await computeMinorProgression(technique, moment, targetJd, provider);
        if (!effect.cancelled) setLoad({ kind: 'ready', data });
      } catch (error) {
        if (!effect.cancelled)
          setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      effect.cancelled = true;
    };
  }, [momentKey(person?.moment), provider, targetDate, technique, mcMethod]);

  if (person === undefined) {
    return <PersonNotFound />;
  }

  if (person.moment === undefined) {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
        </p>
        <h1>{t.progressionsFallback}</h1>
        <p>
          {t.notCompleteProgressions(person.displayName || t.thisPerson)}{' '}
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
        <h1>{t.progressionsFallback}</h1>
        <p>{t.needsKnownTime(person.displayName || t.thisPerson)}</p>
      </main>
    );
  }

  const positions = load.kind === 'ready' ? positionRows(load.data.positions, load.data.houses) : undefined;
  const contacts = load.kind === 'ready' ? crossAspectRows(load.data.contacts) : undefined;
  const usedMcMethod = load.kind === 'ready' && 'mcMethod' in load.data ? load.data.mcMethod : undefined;

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
      </p>
      <h1>{person.displayName ? t.heading(person.displayName) : t.progressionsFallback}</h1>
      <p className="hint">{t.hint}</p>

      <div className="field-grid">
        <label>
          {t.techniqueLabel}
          <select
            value={technique}
            onChange={(event) => {
              setTechnique(event.target.value as Technique);
            }}
          >
            <option value="secondary">{t.secondaryTechnique}</option>
            <option value="tertiary">{t.tertiaryTechnique}</option>
            <option value="minor">{t.minorTechnique}</option>
          </select>
        </label>
        {technique === 'secondary' && (
          <label>
            {t.mcMethodLabel}
            <select
              value={mcMethod}
              onChange={(event) => {
                setMcMethod(event.target.value as ProgressedMcMethod);
              }}
            >
              <option value="quotidian">{t.quotidianMethod}</option>
              <option value="naibod">{t.naibodMethod}</option>
              <option value="solarArc">{t.solarArcMethod}</option>
            </select>
          </label>
        )}
      </div>

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
            {t.ageLine(`${load.data.ageInYears.toFixed(2)}${load.data.ageInYears < 0 ? ` ${t.beforeBirth}` : ''}`)}
          </p>
          {usedMcMethod !== undefined && <p className="hint">{t.mcMethodLine(mcMethodLabel(t, usedMcMethod))}</p>}

          {positions !== undefined && (
            <SortableTable
              caption={t.positionsCaption}
              columns={positionColumns(t, locale)}
              rows={positions}
              getRowKey={(row) => row.bodyKey}
              downloadFilename={deriveExportFilename(person.displayName, 'progressions', 'csv')}
            />
          )}

          {contacts !== undefined && contacts.length > 0 && (
            <SortableTable
              caption={t.contactsCaption}
              columns={contactColumns(t, locale)}
              rows={contacts}
              getRowKey={(row) => `${row.bodyAKey}-${row.aspect}-${row.bodyBKey}`}
              downloadFilename={deriveExportFilename(person.displayName, 'progression-contacts', 'csv')}
            />
          )}
          {contacts?.length === 0 && <p className="hint">{t.noContacts}</p>}
        </>
      )}
    </main>
  );
}
