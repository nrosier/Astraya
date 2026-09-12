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
import { VARGA_PRESETS } from '../astrology/harmonics.js';
import { computeHarmonic, type HarmonicData } from '../domain/harmonic.js';
import { WorkerEphemerisProvider } from '../ephemeris/client.js';
import { ChartDataView } from './ChartView.js';
import { useStoreState } from './store-context.js';
import type { ChartData } from '../domain/chart-compute.js';
import type { EphemerisProvider } from '../ephemeris/types.js';

type Load =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: ChartData }
  | { readonly kind: 'error'; readonly message: string };

const CUSTOM = 'custom';

export function HarmonicView({ personId }: { personId: string }): React.JSX.Element {
  const state = useStoreState();
  const person = state.people.get(personId);

  const [presetKey, setPresetKey] = useState<string>(VARGA_PRESETS[0]?.key ?? CUSTOM);
  const [customN, setCustomN] = useState<string>('5');
  const preset = useMemo(() => VARGA_PRESETS.find((candidate) => candidate.key === presetKey), [presetKey]);
  const n = preset !== undefined ? preset.n : Number.parseInt(customN, 10);
  const nValid = Number.isInteger(n) && n >= 1;

  const [provider, setProvider] = useState<EphemerisProvider | undefined>(undefined);
  const [load, setLoad] = useState<Load>({ kind: 'idle' });

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
  }, [person, provider, n, nValid]);

  if (person === undefined) {
    return (
      <main className="shell">
        <p className="back">
          <a href="#/people">&larr; People</a>
        </p>
        <h1>Not found</h1>
        <p>
          There is no person with that id on this device. If they were deleted, they can be restored from the{' '}
          <a href="#/people">people list</a>.
        </p>
      </main>
    );
  }

  if (person.moment === undefined || person.timeAccuracy === 'unknown') {
    return (
      <main className="shell">
        <p className="back">
          <a href={`#/person/${personId}`}>&larr; {person.displayName || 'Person'}</a>
        </p>
        <h1>Harmonic &amp; Varga charts</h1>
        <p>
          A harmonic chart needs a real Ascendant to build its own houses from, so it needs a complete birth record with
          a known time. {person.displayName || 'This person'}&rsquo;s does not have one yet. Fill in or correct it on
          the <a href={`#/person/${personId}`}>person page</a>.
        </p>
      </main>
    );
  }

  const label = preset !== undefined ? preset.label : `Harmonic ${String(n)}`;
  const displayName = person.displayName ? `${person.displayName} — ${label}` : label;

  return (
    <main className="shell">
      <p className="back">
        <a href={`#/person/${personId}`}>&larr; {person.displayName || 'Person'}</a>
      </p>
      <h1>{person.displayName ? `${person.displayName}’s harmonic chart` : 'Harmonic chart'}</h1>
      <p className="hint">
        Every longitude multiplied by a whole number and wrapped back into the zodiac, with whole-sign houses built from
        the multiplied Ascendant &mdash; the general mechanism behind both harmonic charts and Vedic Varga (divisional)
        charts. See the named presets&rsquo; own note on which Varga convention each one follows.
      </p>

      <div className="field-grid">
        <label>
          Divisional chart
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
            <option value={CUSTOM}>Custom harmonic&hellip;</option>
          </select>
        </label>
        {presetKey === CUSTOM && (
          <label>
            Harmonic number
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
          Enter a whole number of 1 or more.
        </p>
      )}

      {nValid && load.kind !== 'idle' && (
        <ChartDataView load={load} displayName={displayName} showHouses metaLines={[label]} />
      )}
    </main>
  );
}
