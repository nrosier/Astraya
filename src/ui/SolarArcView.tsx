/**
 * Solar arc directions for one person (#398), computed as of a chosen date.
 *
 * A separate screen from `ProgressionsView.tsx` rather than a fourth technique option there:
 * `DirectedContact`'s own `exactJd` (when a contact becomes exact) has no equivalent in a plain
 * progressed chart, and `DirectedPosition` carries no speed/retrograde data the way a real
 * ephemeris position does — different enough table shapes to warrant their own screen, the same
 * reasoning that already split `TransitView.tsx` from `PeriodicTransitView.tsx`.
 *
 * Needs a known birth time, same gate every angle-dependent screen in this app already uses.
 */
import { useEffect, useMemo, useState } from 'react';
import { bodyById } from '../astrology/bodies.js';
import type { DirectedPosition } from '../astrology/solar-arc-directions.js';
import { aspectDisplayName, bodyDisplayName, signDisplayName } from './astro-names.messages.js';
import { housesAreDefined } from '../domain/chart-compute.js';
import { degreeParts, type AspectRow, type DegreeParts } from '../domain/chart-tables.js';
import { deriveExportFilename } from '../domain/export-filename.js';
import { houseOf } from '../astrology/emphasis.js';
import {
  computeSolarArcDirections,
  type DirectedContact,
  type SolarArcDirectionsData,
} from '../domain/solar-arc-directions.js';
import { useEphemerisProvider } from './EphemerisProviderContext.js';
import { civilFromJulianDay } from '../time/julian.js';
import { todayInputValue } from './format.js';
import { useLocale } from './locale.js';
import { useMessages } from './messages.js';
import { momentKey } from '../time/encode.js';
import { PersonNotFound } from './PersonNotFound.js';
import { SortableTable } from './SortableTable.js';
import { solarArcViewMessages } from './SolarArcView.messages.js';
import { useStoreState } from './store-context.js';
import type { TableColumn } from './table-sort.js';
import type { HousePositions, JulianDayUT } from '../ephemeris/types.js';
import type { Locale } from '../interpretation/schema.js';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: SolarArcDirectionsData }
  | { readonly kind: 'error'; readonly message: string };

interface PositionRow extends DegreeParts {
  readonly bodyKey: string;
  readonly bodyName: string;
  readonly house?: number;
}

/** Same `includeAngles` convention as `chart-tables.ts`'s `positionRows` — Ascendant/Midheaven appended, not a separate table. */
function positionRows(positions: readonly DirectedPosition[], houses: HousePositions): readonly PositionRow[] {
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

function positionColumns(t: typeof solarArcViewMessages.en, locale: Locale): readonly TableColumn<PositionRow>[] {
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

interface ContactRow extends AspectRow {
  readonly exactJd: JulianDayUT | undefined;
}

function toContactRow(contact: DirectedContact): ContactRow {
  const bodyA = bodyById(contact.bodyA);
  const bodyB = bodyById(contact.bodyB);
  return {
    bodyAKey: bodyA?.key ?? String(contact.bodyA),
    bodyAName: bodyA?.name ?? String(contact.bodyA),
    bodyBKey: bodyB?.key ?? String(contact.bodyB),
    bodyBName: bodyB?.name ?? String(contact.bodyB),
    aspect: contact.aspect.name,
    aspectKey: contact.aspect.key,
    angle: contact.aspect.angle,
    separation: contact.separation,
    orb: contact.orb,
    applying: contact.applying,
    exactJd: contact.exactJd,
  };
}

function formatExactDate(jd: JulianDayUT | undefined, t: typeof solarArcViewMessages.en): string {
  if (jd === undefined) return t.exactOnUnknown;
  const civil = civilFromJulianDay(jd);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${String(civil.year)}-${pad(civil.month)}-${pad(civil.day)}`;
}

function contactColumns(t: typeof solarArcViewMessages.en, locale: Locale): readonly TableColumn<ContactRow>[] {
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
    {
      key: 'exactJd',
      label: t.exactOnLabel,
      valueOf: (row) => row.exactJd ?? '',
      render: (row) => formatExactDate(row.exactJd, t),
    },
  ];
}

export function SolarArcView({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);
  const t = useMessages(solarArcViewMessages);
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
        const targetJd = await provider.julianDayFromUtc(targetDate.year, targetDate.month, targetDate.day, 12, 0, 0);
        const data = await computeSolarArcDirections(moment, targetJd, provider);
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

  if (person === undefined) {
    return <PersonNotFound />;
  }

  if (person.moment === undefined) {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
        </p>
        <h1>{t.solarArcFallback}</h1>
        <p>
          {t.notCompleteSolarArc(person.displayName || t.thisPerson)}{' '}
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
        <h1>{t.solarArcFallback}</h1>
        <p>{t.needsKnownTime(person.displayName || t.thisPerson)}</p>
      </main>
    );
  }

  const positions = load.kind === 'ready' ? positionRows(load.data.directedPositions, load.data.houses) : undefined;
  const contacts = load.kind === 'ready' ? load.data.contacts.map(toContactRow) : undefined;

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
      </p>
      <h1>{person.displayName ? t.heading(person.displayName) : t.solarArcFallback}</h1>
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
            {t.ageLine(`${load.data.ageInYears.toFixed(2)}${load.data.ageInYears < 0 ? ` ${t.beforeBirth}` : ''}`)}
          </p>
          <p className="hint">{t.arcLine(load.data.arc.toFixed(2))}</p>

          {positions !== undefined && (
            <SortableTable
              caption={t.positionsCaption}
              columns={positionColumns(t, locale)}
              rows={positions}
              getRowKey={(row) => row.bodyKey}
              downloadFilename={deriveExportFilename(person.displayName, 'solar-arc', 'csv')}
            />
          )}

          {contacts !== undefined && contacts.length > 0 && (
            <SortableTable
              caption={t.contactsCaption}
              columns={contactColumns(t, locale)}
              rows={contacts}
              getRowKey={(row) => `${row.bodyAKey}-${row.aspect}-${row.bodyBKey}`}
              downloadFilename={deriveExportFilename(person.displayName, 'solar-arc-contacts', 'csv')}
            />
          )}
          {contacts?.length === 0 && <p className="hint">{t.noContacts}</p>}
        </>
      )}
    </main>
  );
}
