/**
 * Bridges a saved chart's generic `settings` to this module's strongly-typed
 * overlay display options (#148's antiscia/declination/dial toggles).
 *
 * Mirrors `wheel-options.ts`'s (#43) exact pattern — read a setting, fall
 * back to a rendering default for anything missing or holding a value this
 * build doesn't recognise — extended to booleans and orbs (`pick` there only
 * ever validated a fixed string enum). A cosmetic overlay toggle or orb
 * should never stop a chart from drawing, the same reasoning `wheel-options.ts`
 * gives for its own fallbacks.
 */
import type { Degrees } from '../ephemeris/types.js';
import type { JsonValue } from '../store/ops.js';

export const ANTISCIA_VISIBLE_SETTING = 'antisciaVisible';
export const ANTISCIA_MAX_ORB_SETTING = 'antisciaMaxOrb';
export const DECLINATION_VISIBLE_SETTING = 'declinationVisible';
export const DECLINATION_MAX_ORB_SETTING = 'declinationMaxOrb';
export const DIAL90_VISIBLE_SETTING = 'dial90Visible';
export const MIDPOINT_TREE_ORB_SETTING = 'midpointTreeOrb';

export interface OverlayDisplayOptions {
  readonly antisciaVisible: boolean;
  readonly antisciaMaxOrb: Degrees;
  readonly declinationVisible: boolean;
  readonly declinationMaxOrb: Degrees;
  readonly dial90Visible: boolean;
  readonly midpointTreeOrb: Degrees;
}

/** Conservative default orb, until the UI exposes its own control — matches the tightest base orb in `DEFAULT_ORB_CONFIG` (aspects.ts). */
const DEFAULT_MAX_ORB: Degrees = 1;
const DEFAULT_VISIBLE = false;

function pickBoolean(value: JsonValue | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickOrb(value: JsonValue | undefined, fallback: Degrees): Degrees {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Resolves a saved chart's overlay-display settings, defaulting anything absent or unrecognised. */
export function resolveOverlayDisplayOptions(settings: Readonly<Record<string, JsonValue>>): OverlayDisplayOptions {
  return {
    antisciaVisible: pickBoolean(settings[ANTISCIA_VISIBLE_SETTING], DEFAULT_VISIBLE),
    antisciaMaxOrb: pickOrb(settings[ANTISCIA_MAX_ORB_SETTING], DEFAULT_MAX_ORB),
    declinationVisible: pickBoolean(settings[DECLINATION_VISIBLE_SETTING], DEFAULT_VISIBLE),
    declinationMaxOrb: pickOrb(settings[DECLINATION_MAX_ORB_SETTING], DEFAULT_MAX_ORB),
    dial90Visible: pickBoolean(settings[DIAL90_VISIBLE_SETTING], DEFAULT_VISIBLE),
    midpointTreeOrb: pickOrb(settings[MIDPOINT_TREE_ORB_SETTING], DEFAULT_MAX_ORB),
  };
}
