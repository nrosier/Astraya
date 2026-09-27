/**
 * Synastry bi-wheel comparing a saved person against a second saved person (#172), using
 * #51's cross-chart aspect engine and #52's multi-ring renderer.
 *
 * The second person is picked from within this screen, not carried in the URL: every other
 * multi-word route in `route.ts` names exactly one person, and a synastry pairing changes far
 * more often within one visit (trying several comparisons) than it's worth making shareable
 * as a link. The picker only offers people with a complete, known-time birth moment — the
 * same requirement `person` itself is gated on below — since a bi-wheel needs houses on both
 * rings.
 *
 * The wheel bypasses `AstroChartWheel.tsx` (single-chart only) the same way `TransitView.tsx`
 * does, calling `renderMultiWheelSvg` directly. Unlike a transit wheel, neither side is a
 * "reference at rest" the other moves against, so `computeSynastry` uses each chart's own real
 * speed on both sides (see that module's doc comment) — and correspondingly there is no
 * inner/outer convention rooted in the astrology here, only in the SVG's ring order.
 */
import { useEffect, useMemo, useState } from 'react';
import { useEphemerisProvider } from './EphemerisProviderContext.js';
import { chartWheelRing, crossAspectRows, type AspectRow } from '../domain/chart-tables.js';
import { deriveExportFilename } from '../domain/export-filename.js';
import { computeSynastry, type SynastryData } from '../domain/synastry.js';
import { renderMultiWheelSvg, type CrossRingAspects } from '../chart/multi-wheel.js';
import { aspectDisplayName, bodyDisplayName } from './astro-names.messages.js';
import { useLocale } from './locale.js';
import { useMessages } from './messages.js';
import { ordered } from './people-list.js';
import { momentKey } from '../time/encode.js';
import { PersonNotFound } from './PersonNotFound.js';
import { SortableTable } from './SortableTable.js';
import { useStoreState } from './store-context.js';
import { synastryViewMessages } from './SynastryView.messages.js';
import type { TableColumn } from './table-sort.js';
import type { Locale } from '../interpretation/schema.js';

type Load =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: SynastryData }
  | { readonly kind: 'error'; readonly message: string };

function aspectColumns(t: typeof synastryViewMessages.en, locale: Locale): readonly TableColumn<AspectRow>[] {
  return [
    {
      key: 'bodyAName',
      label: t.personALabel,
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
      label: t.personBLabel,
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

export function SynastryView({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);
  const t = useMessages(synastryViewMessages);
  const [locale] = useLocale();

  const candidates = useMemo(
    () =>
      ordered(state.people).filter(
        (candidate) =>
          candidate.id !== personId && candidate.moment !== undefined && candidate.timeAccuracy !== 'unknown',
      ),
    [state.people, personId],
  );
  const [partnerId, setPartnerId] = useState<string>('');
  const partner = partnerId === '' ? undefined : state.people.get(partnerId);

  const { provider } = useEphemerisProvider();
  const [load, setLoad] = useState<Load>({ kind: 'idle' });

  useEffect(() => {
    if (person?.moment === undefined || partner?.moment === undefined || provider === undefined) {
      setLoad({ kind: 'idle' });
      return undefined;
    }
    const momentA = person.moment;
    const momentB = partner.moment;
    const effect = { cancelled: false };
    setLoad({ kind: 'loading' });

    void (async () => {
      try {
        const data = await computeSynastry(momentA, momentB, provider);
        if (!effect.cancelled) setLoad({ kind: 'ready', data });
      } catch (error) {
        if (!effect.cancelled)
          setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      effect.cancelled = true;
    };
  }, [momentKey(person?.moment), momentKey(partner?.moment), provider]);

  const wheelMarkup = useMemo(() => {
    if (load.kind !== 'ready') return undefined;
    const nameA: string = person?.displayName ?? '';
    const nameB: string = partner?.displayName ?? '';
    const ringA = chartWheelRing(load.data.chartA, nameA || t.personALabel);
    const ringB = chartWheelRing(load.data.chartB, nameB || t.personBLabel);
    const crossAspects: readonly CrossRingAspects[] = [
      // `computeSynastry`'s aspects run bodyA from chartA (ring 0), bodyB from chartB (ring
      // 1) — outerRingIndex/innerRingIndex name which side of the aspect a ring resolves,
      // not radius order, so chartA is "outer" here even though it's drawn as ring 0.
      { outerRingIndex: 0, innerRingIndex: 1, aspects: load.data.aspects },
    ];
    return renderMultiWheelSvg([ringA, ringB], crossAspects);
  }, [load, person, partner, t]);

  if (person === undefined) {
    return <PersonNotFound />;
  }

  if (person.moment === undefined || person.timeAccuracy === 'unknown') {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
        </p>
        <h1>{t.synastryFallback}</h1>
        <p>
          {t.needsCompleteRecord(person.displayName || t.thisPerson)}{' '}
          <a href={`#/person/${personId}`}>{t.personPageLink}</a>.
        </p>
      </main>
    );
  }

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
      </p>
      <h1>{person.displayName ? t.heading(person.displayName) : t.synastryFallback}</h1>
      <p className="hint">{t.hint}</p>

      <p>
        <label>
          {t.compareWithLabel}{' '}
          <select
            value={partnerId}
            onChange={(event) => {
              setPartnerId(event.target.value);
            }}
          >
            <option value="">{t.choosePersonOption}</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.displayName || t.unnamedOption}
              </option>
            ))}
          </select>
        </label>
      </p>

      {partnerId !== '' && candidates.every((candidate) => candidate.id !== partnerId) && (
        <p className="warning" role="alert">
          {t.partnerGoneWarning}
        </p>
      )}

      {load.kind === 'loading' && <p className="status">{t.calculating}</p>}

      {load.kind === 'error' && (
        <p className="warning" role="alert">
          {t.error(load.message)}
        </p>
      )}

      {load.kind === 'ready' && wheelMarkup !== undefined && (
        <>
          {/* App-generated SVG from just-computed chart data, never user-supplied markup —
              the same trust boundary ChartView.tsx's sheet markup is injected under. */}
          <div className="chart-wheel" dangerouslySetInnerHTML={{ __html: wheelMarkup }} />

          <SortableTable
            caption={t.aspectsCaption}
            columns={aspectColumns(t, locale)}
            rows={crossAspectRows(load.data.aspects)}
            getRowKey={(row) => `${row.bodyAKey}-${row.aspect}-${row.bodyBKey}`}
            downloadFilename={deriveExportFilename(
              `${person.displayName || 'person'}-${(partner?.displayName ?? '') || 'partner'}`,
              'synastry-aspects',
              'csv',
            )}
          />
        </>
      )}
    </main>
  );
}
