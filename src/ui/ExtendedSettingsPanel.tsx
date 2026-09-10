/**
 * The "Extended settings" panel (#52), modeled on Astro-Seek's own panel of
 * the same name: house system, zodiac/ayanamsa, the orb-scale slider, minor
 * aspects, which points are shown, which participate in aspect-finding, and
 * the wheel's cosmetic Rainbow Color Zodiac fill.
 *
 * Edits a local draft rather than `value` directly: every one of these
 * settings requires a real recompute (a new ephemeris pass, for most of
 * them), so committing on every keystroke would mean refetching on every
 * keystroke. "Redraw" is the one point where `onRedraw(draft)` runs,
 * matching the user's own framing of the feature ("set these settings and
 * redraw").
 */
import { useEffect, useState } from 'react';
import { ASPECTS } from '../astrology/aspects.js';
import { ayanamsaByKey, AYANAMSAS } from '../astrology/ayanamsas.js';
import { HOUSE_SYSTEMS } from '../astrology/houses.js';
import { DEFAULT_EXTENDED_SETTINGS, type ExtendedSettings } from '../chart/extended-settings.js';
import type { EphemerisProvider } from '../ephemeris/types.js';

const MINOR_ASPECTS = ASPECTS.filter((aspect) => aspect.family === 'minor');

const LAHIRI_AYANAMSA_ID = ayanamsaByKey('lahiri')?.id ?? AYANAMSAS[0]?.id ?? 1;

/** Fetches every house-system/ayanamsa display name once, falling back to the machine key while pending. */
function useNameLookup<T extends number | string>(
  ids: readonly T[],
  fetchName: (id: T) => Promise<string>,
): ReadonlyMap<T, string> {
  const [names, setNames] = useState<ReadonlyMap<T, string>>(new Map());

  useEffect(() => {
    const effect = { cancelled: false };
    void Promise.all(ids.map((id) => fetchName(id).then((name): readonly [T, string] => [id, name])))
      .then((entries) => {
        if (!effect.cancelled) setNames(new Map(entries));
      })
      // Names are cosmetic labels; the machine key already shown is a fine fallback on failure.
      .catch(() => undefined);
    return () => {
      effect.cancelled = true;
    };
    // `ids`/`fetchName` are treated as stable for the lifetime of one provider instance.
  }, []);

  return names;
}

export function ExtendedSettingsPanel({
  value,
  onRedraw,
  provider,
}: {
  readonly value: ExtendedSettings;
  readonly onRedraw: (next: ExtendedSettings) => void;
  readonly provider: EphemerisProvider;
}): React.JSX.Element {
  const [draft, setDraft] = useState<ExtendedSettings>(value);

  const houseSystemNames = useNameLookup(
    HOUSE_SYSTEMS.map((system) => system.code),
    (code) => provider.houseSystemName(code),
  );
  const ayanamsaNames = useNameLookup(
    AYANAMSAS.map((ayanamsa) => ayanamsa.id),
    (id) => provider.ayanamsaName(id),
  );

  const patch = (partial: Partial<ExtendedSettings>): void => {
    setDraft((current) => ({ ...current, ...partial }));
  };

  const setMinorAspect = (key: string, enabled: boolean): void => {
    patch({
      enabledMinorAspects: enabled
        ? [...draft.enabledMinorAspects, key]
        : draft.enabledMinorAspects.filter((enabledKey) => enabledKey !== key),
    });
  };

  const ayanamsaId = draft.zodiac.kind === 'sidereal' ? draft.zodiac.ayanamsa : undefined;

  return (
    <details className="extended-settings">
      <summary>Extended settings</summary>

      <fieldset className="field-group">
        <legend>House system</legend>
        <div className="field-grid">
          <label>
            System
            <select
              value={draft.houseSystem}
              onChange={(event) => {
                patch({ houseSystem: event.target.value });
              }}
            >
              {HOUSE_SYSTEMS.map((system) => (
                <option key={system.code} value={system.code}>
                  {houseSystemNames.get(system.code) ?? system.key}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset className="field-group">
        <legend>Zodiac</legend>
        <div role="radiogroup" aria-label="Zodiac">
          <label>
            <input
              type="radio"
              name="extended-settings-zodiac"
              checked={draft.zodiac.kind === 'tropical'}
              onChange={() => {
                patch({ zodiac: { kind: 'tropical' } });
              }}
            />{' '}
            Tropical
          </label>{' '}
          <label>
            <input
              type="radio"
              name="extended-settings-zodiac"
              checked={draft.zodiac.kind === 'sidereal'}
              onChange={() => {
                patch({ zodiac: { kind: 'sidereal', ayanamsa: LAHIRI_AYANAMSA_ID } });
              }}
            />{' '}
            Sidereal
          </label>
        </div>
        {draft.zodiac.kind === 'sidereal' && (
          <label>
            Ayanamsa
            <select
              value={ayanamsaId}
              onChange={(event) => {
                patch({ zodiac: { kind: 'sidereal', ayanamsa: Number(event.target.value) } });
              }}
            >
              {AYANAMSAS.map((ayanamsa) => (
                <option key={ayanamsa.id} value={ayanamsa.id}>
                  {ayanamsaNames.get(ayanamsa.id) ?? ayanamsa.key}
                </option>
              ))}
            </select>
          </label>
        )}
      </fieldset>

      <fieldset className="field-group">
        <legend>Orb</legend>
        <label>
          Scale: {draft.orbScalePercent > 0 ? '+' : ''}
          {draft.orbScalePercent}%
          <input
            type="range"
            aria-label="Orb scale"
            min={-90}
            max={90}
            step={10}
            value={draft.orbScalePercent}
            onChange={(event) => {
              patch({ orbScalePercent: Number(event.target.value) });
            }}
          />
        </label>
        <p className="hint">
          Major aspects: 7° base, 10° with a luminary. Sextile: 4° base, 5°30&prime; with a luminary. Minor aspects: a
          flat 2°30&prime;. The scale above widens or narrows every one of these at once.
        </p>
      </fieldset>

      <fieldset className="field-group">
        <legend>Minor aspects</legend>
        {MINOR_ASPECTS.map((aspect) => (
          <label key={aspect.key}>
            <input
              type="checkbox"
              checked={draft.enabledMinorAspects.includes(aspect.key)}
              onChange={(event) => {
                setMinorAspect(aspect.key, event.target.checked);
              }}
            />{' '}
            {aspect.angle}° {aspect.name}
          </label>
        ))}
      </fieldset>

      <fieldset className="field-group">
        <legend>Points shown</legend>
        <label>
          <input
            type="checkbox"
            checked={draft.fortuneVisible}
            onChange={(event) => {
              patch({ fortuneVisible: event.target.checked });
            }}
          />{' '}
          Part of Fortune
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.vertexVisible}
            onChange={(event) => {
              patch({ vertexVisible: event.target.checked });
            }}
          />{' '}
          Vertex
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.chironVisible}
            onChange={(event) => {
              patch({ chironVisible: event.target.checked });
            }}
          />{' '}
          Chiron
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.midpointsVisible}
            onChange={(event) => {
              patch({ midpointsVisible: event.target.checked });
            }}
          />{' '}
          Midpoints (ASC/MC, Sun/Moon)
        </label>
        <div role="radiogroup" aria-label="Lilith model">
          Lilith:{' '}
          <label>
            <input
              type="radio"
              name="extended-settings-lilith"
              checked={draft.lilithVariant === 'mean'}
              onChange={() => {
                patch({ lilithVariant: 'mean' });
              }}
            />{' '}
            Mean
          </label>{' '}
          <label>
            <input
              type="radio"
              name="extended-settings-lilith"
              checked={draft.lilithVariant === 'true'}
              onChange={() => {
                patch({ lilithVariant: 'true' });
              }}
            />{' '}
            True
          </label>
        </div>
        <div role="radiogroup" aria-label="Lunar node model">
          Lunar Nodes:{' '}
          <label>
            <input
              type="radio"
              name="extended-settings-node"
              checked={draft.nodeVariant === 'mean'}
              onChange={() => {
                patch({ nodeVariant: 'mean' });
              }}
            />{' '}
            Mean
          </label>{' '}
          <label>
            <input
              type="radio"
              name="extended-settings-node"
              checked={draft.nodeVariant === 'true'}
              onChange={() => {
                patch({ nodeVariant: 'true' });
              }}
            />{' '}
            True
          </label>
        </div>
        <label>
          <input
            type="checkbox"
            checked={draft.rainbowZodiac}
            onChange={(event) => {
              patch({ rainbowZodiac: event.target.checked });
            }}
          />{' '}
          Rainbow Color Zodiac
        </label>
      </fieldset>

      <fieldset className="field-group">
        <legend>Aspects to</legend>
        <label>
          <input
            type="checkbox"
            checked={draft.aspectsToChiron}
            onChange={(event) => {
              patch({ aspectsToChiron: event.target.checked });
            }}
          />{' '}
          Chiron
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.aspectsToLilith}
            onChange={(event) => {
              patch({ aspectsToLilith: event.target.checked });
            }}
          />{' '}
          Lilith
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.aspectsToLunarNodes}
            onChange={(event) => {
              patch({ aspectsToLunarNodes: event.target.checked });
            }}
          />{' '}
          Lunar Nodes
        </label>
        <p className="hint">
          Aspects to the Part of Fortune, Vertex, Ascendant and Midheaven aren&rsquo;t supported yet.
        </p>
      </fieldset>

      <p>
        <button
          type="button"
          className="quiet"
          onClick={() => {
            onRedraw(draft);
          }}
        >
          Redraw
        </button>{' '}
        <button
          type="button"
          className="quiet"
          onClick={() => {
            setDraft(DEFAULT_EXTENDED_SETTINGS);
          }}
        >
          Reset to defaults
        </button>
      </p>
    </details>
  );
}
