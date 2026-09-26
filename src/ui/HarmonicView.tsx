/**
 * Harmonic and Vedic Varga (divisional) charts for a saved person (#170).
 *
 * A harmonic chart is a single synthetic chart derived from one natal chart, not a comparison
 * between two — like the composite chart (#169), this screen reuses `ChartDataView` wholesale
 * rather than the multi-wheel renderer. Unlike composite, there is only one input record, so the
 * in-screen picker here is the harmonic number rather than a second person: either a named Varga
 * preset (`VARGA_PRESETS`) or any positive integer, per the issue's "N selectable" ask.
 */
import { useEffect, useMemo, useState } from 'react';
import { useEphemerisProvider } from './EphemerisProviderContext.js';
import { VARGA_PRESETS } from '../astrology/harmonics.js';
import { computeHarmonic, type HarmonicData } from '../domain/harmonic.js';
import { momentKey } from '../time/encode.js';
import { ChartDataView } from './ChartView.js';
import { harmonicViewMessages } from './HarmonicView.messages.js';
import { useMessages } from './messages.js';
import { PersonNotFound } from './PersonNotFound.js';
import { useStoreState } from './store-context.js';
import type { ChartData } from '../domain/chart-compute.js';

type Load =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: ChartData }
  | { readonly kind: 'error'; readonly message: string };

const CUSTOM = 'custom';

export function HarmonicView({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);
  const t = useMessages(harmonicViewMessages);

  const [presetKey, setPresetKey] = useState<string>(VARGA_PRESETS[0]?.key ?? CUSTOM);
  const [customN, setCustomN] = useState<string>('5');
  const preset = useMemo(() => VARGA_PRESETS.find((candidate) => candidate.key === presetKey), [presetKey]);
  const n = preset !== undefined ? preset.n : Number.parseInt(customN, 10);
  const nValid = Number.isInteger(n) && n >= 1;

  const { provider } = useEphemerisProvider();
  const [load, setLoad] = useState<Load>({ kind: 'idle' });

  useEffect(() => {
    if (person?.moment === undefined || provider === undefined || !nValid) {
      setLoad({ kind: 'idle' });
      return undefined;
    }
    const moment = person.moment;
    const effect = { cancelled: false };
    setLoad({ kind: 'loading' });

    void (async () => {
      try {
        const data: HarmonicData = await computeHarmonic(moment, n, provider);
        if (!effect.cancelled) setLoad({ kind: 'ready', data: data.harmonic });
      } catch (error) {
        if (!effect.cancelled)
          setLoad({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })();

    return () => {
      effect.cancelled = true;
    };
  }, [momentKey(person?.moment), provider, n, nValid]);

  if (person === undefined) {
    return <PersonNotFound />;
  }

  if (person.moment === undefined || person.timeAccuracy === 'unknown') {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
        </p>
        <h1>{t.harmonicChartsFallback}</h1>
        <p>
          {t.needsCompleteRecord(person.displayName || t.thisPerson)}{' '}
          <a href={`#/person/${personId}`}>{t.personPageLink}</a>.
        </p>
      </main>
    );
  }

  const label = preset !== undefined ? preset.label : t.harmonicLabel(String(n));
  const displayName = person.displayName ? `${person.displayName} — ${label}` : label;

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || t.personFallback}</a>
      </p>
      <h1>{person.displayName ? t.heading(person.displayName) : t.headingFallback}</h1>
      <p className="hint">{t.hint}</p>

      <div className="field-grid">
        <label>
          {t.divisionalChartLabel}
          <select
            value={presetKey}
            onChange={(event) => {
              setPresetKey(event.target.value);
            }}
          >
            {VARGA_PRESETS.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.label}
              </option>
            ))}
            <option value={CUSTOM}>{t.customHarmonicOption}</option>
          </select>
        </label>
        {presetKey === CUSTOM && (
          <label>
            {t.harmonicNumberLabel}
            <input
              type="number"
              min={1}
              step={1}
              value={customN}
              onChange={(event) => {
                setCustomN(event.target.value);
              }}
            />
          </label>
        )}
      </div>

      {preset !== undefined && <p className="hint">{preset.description}</p>}
      {presetKey === CUSTOM && !nValid && (
        <p className="warning" role="alert">
          {t.invalidHarmonicNumber}
        </p>
      )}

      {nValid && load.kind !== 'idle' && (
        <ChartDataView load={load} displayName={displayName} showHouses metaLines={[label]} />
      )}
    </main>
  );
}
