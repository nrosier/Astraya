/**
 * The canonical set of house systems Astraya offers (#19).
 *
 * Swiss Ephemeris identifies a house system by a single-character code passed
 * to `swe_houses_ex2`; this is the list of codes worth exposing in the UI, each
 * given a stable machine `key` so saved charts don't depend on display text.
 * The codes and cusp counts below were read off a live `sweph-wasm` instance
 * (`swe_house_name` and `swe_houses_ex2`), never transcribed from documentation
 * — the project's ephemeris values are always verified against the running
 * library, and house systems are no exception.
 *
 * Display names are deliberately *not* hardcoded here: `src/astrology/**` is
 * pure functions over resolved positions with no WASM, so the human-readable
 * name for a code comes from `EphemerisProvider.houseSystemName`, which wraps
 * `swe_house_name` at the ephemeris boundary. That keeps exactly one source of
 * truth for the text instead of a second copy here that could drift from it.
 *
 * `'E'` is excluded: `swe_house_name` reports it as identical to `'A'`
 * ("equal") — verified empirically, not merely assumed from the letter gap in
 * the alphabet — so it is a legacy alias rather than a distinct system.
 */
import type { HouseSystem } from '../ephemeris/types.js';

export interface HouseSystemDefinition {
  readonly code: HouseSystem;
  readonly key: string;
  /**
   * Cusps per system, index 1..n as returned by `swe_houses_ex2` (see the note
   * in `engine.ts` on 1-based indexing). 12 for every quadrant/equal-division
   * system; Gauquelin sectors (`'G'`) is the sole exception at 36.
   */
  readonly cuspCount: number;
}

export const HOUSE_SYSTEMS: readonly HouseSystemDefinition[] = [
  { code: 'A', key: 'equal', cuspCount: 12 },
  { code: 'B', key: 'alcabitius', cuspCount: 12 },
  { code: 'C', key: 'campanus', cuspCount: 12 },
  { code: 'D', key: 'equalMidheaven', cuspCount: 12 },
  { code: 'F', key: 'carterPoliEquatorial', cuspCount: 12 },
  { code: 'G', key: 'gauquelinSectors', cuspCount: 36 },
  { code: 'H', key: 'horizon', cuspCount: 12 },
  { code: 'I', key: 'sunshine', cuspCount: 12 },
  { code: 'i', key: 'sunshineAlt', cuspCount: 12 },
  { code: 'K', key: 'koch', cuspCount: 12 },
  { code: 'L', key: 'pullenSinusoidalDelta', cuspCount: 12 },
  { code: 'M', key: 'morinus', cuspCount: 12 },
  { code: 'N', key: 'equalAries', cuspCount: 12 },
  { code: 'O', key: 'porphyry', cuspCount: 12 },
  { code: 'P', key: 'placidus', cuspCount: 12 },
  { code: 'Q', key: 'pullenSinusoidalRatio', cuspCount: 12 },
  { code: 'R', key: 'regiomontanus', cuspCount: 12 },
  { code: 'S', key: 'sripati', cuspCount: 12 },
  { code: 'T', key: 'polichPage', cuspCount: 12 },
  { code: 'U', key: 'krusinskiPisaGoelzer', cuspCount: 12 },
  { code: 'V', key: 'vehlowEqual', cuspCount: 12 },
  { code: 'W', key: 'wholeSign', cuspCount: 12 },
  { code: 'X', key: 'axialRotation', cuspCount: 12 },
  { code: 'Y', key: 'apc', cuspCount: 12 },
];

const BY_CODE = new Map<HouseSystem, HouseSystemDefinition>(HOUSE_SYSTEMS.map((system) => [system.code, system]));
const BY_KEY = new Map<string, HouseSystemDefinition>(HOUSE_SYSTEMS.map((system) => [system.key, system]));

export function houseSystemByCode(code: HouseSystem): HouseSystemDefinition | undefined {
  return BY_CODE.get(code);
}

export function houseSystemByKey(key: string): HouseSystemDefinition | undefined {
  return BY_KEY.get(key);
}
