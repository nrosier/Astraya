/**
 * The canonical set of sidereal modes (ayanamsas) Astraya offers (#21).
 *
 * Every `SE_SIDM_*` constant in `generated-constants.ts` names a predefined
 * ayanamsa — that file is itself generated from a live `sweph-wasm` instance
 * (see its own doc comment), so deriving this list from it rather than
 * hand-copying ~46 ids keeps the same "never transcribed" guarantee one level
 * up: a future Swiss Ephemeris release that adds a mode is picked up the next
 * time `gen-constants.mjs` runs, with no edit needed here.
 *
 * `SE_SIDM_USER` is excluded: it selects a caller-supplied custom ayanamsa
 * rather than naming a predefined one, so it has no fixed reference point to
 * list.
 *
 * As with `houses.ts`, display names are not hardcoded here: they come from
 * `EphemerisProvider.ayanamsaName`, a thin wrapper over
 * `swe_get_ayanamsa_name`, so there is one source of truth for the text shown
 * in the UI.
 */
import { SE } from '../ephemeris/generated-constants.js';

export interface AyanamsaDefinition {
  readonly id: number;
  readonly key: string;
}

/** "SE_SIDM_TRUE_CITRA" -> "trueCitra". */
function keyFromConstantName(name: string): string {
  const [first, ...rest] = name
    .replace(/^SE_SIDM_/, '')
    .toLowerCase()
    .split('_');
  return [first, ...rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1))].join('');
}

export const AYANAMSAS: readonly AyanamsaDefinition[] = Object.entries(SE)
  .filter(([name]) => name.startsWith('SE_SIDM_') && name !== 'SE_SIDM_USER')
  .map(([name, id]) => ({ id, key: keyFromConstantName(name) }))
  .sort((a, b) => a.id - b.id);

const BY_ID = new Map<number, AyanamsaDefinition>(AYANAMSAS.map((ayanamsa) => [ayanamsa.id, ayanamsa]));
const BY_KEY = new Map<string, AyanamsaDefinition>(AYANAMSAS.map((ayanamsa) => [ayanamsa.key, ayanamsa]));

export function ayanamsaById(id: number): AyanamsaDefinition | undefined {
  return BY_ID.get(id);
}

export function ayanamsaByKey(key: string): AyanamsaDefinition | undefined {
  return BY_KEY.get(key);
}
