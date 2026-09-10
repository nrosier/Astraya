/**
 * Bridges a saved chart's generic `settings` to this module's strongly-typed
 * wheel display options (#43's "choices persist with the saved chart").
 *
 * `Chart` (`src/domain/chart.ts`, #98) deliberately keeps every setting as an
 * untyped `JsonValue` and never validates individual keys — the authority on
 * which values are valid lives with whichever module actually consumes the
 * setting, not with the chart record, so it cannot drift out of step with a
 * list kept elsewhere. This module is that authority for the three
 * wheel-display settings below: it reads them out of a chart's `settings`
 * record and falls back to the rendering default for anything missing or
 * holding a value this build doesn't recognise (an older or newer build's
 * setting, or plain corruption) — a cosmetic rendering choice should never
 * stop a chart from drawing.
 */
import type { JsonValue } from '../store/ops.js';
import type { HouseWedgeStyle, SignWedgeStyle, WheelOrientation, WheelSweep } from './wheel.js';

export const WHEEL_ORIENTATION_SETTING = 'wheelOrientation';
export const WHEEL_SWEEP_SETTING = 'wheelSweep';
export const HOUSE_WEDGE_STYLE_SETTING = 'houseWedgeStyle';
export const SIGN_WEDGE_STYLE_SETTING = 'signWedgeStyle';

export interface WheelDisplayOptions {
  readonly orientation: WheelOrientation;
  readonly sweep: WheelSweep;
  readonly houseWedgeStyle: HouseWedgeStyle;
  readonly signWedgeStyle: SignWedgeStyle;
}

const ORIENTATIONS: readonly WheelOrientation[] = ['asc-left', 'aries-up'];
const SWEEPS: readonly WheelSweep[] = ['counterclockwise', 'clockwise'];
const HOUSE_WEDGE_STYLES: readonly HouseWedgeStyle[] = ['equal-degree', 'whole-sign'];
const SIGN_WEDGE_STYLES: readonly SignWedgeStyle[] = ['default', 'rainbow'];

function pick<T extends string>(value: JsonValue | undefined, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Resolves a saved chart's wheel-display settings, defaulting anything absent or unrecognised. */
export function resolveWheelDisplayOptions(settings: Readonly<Record<string, JsonValue>>): WheelDisplayOptions {
  return {
    orientation: pick(settings[WHEEL_ORIENTATION_SETTING], ORIENTATIONS, 'asc-left'),
    sweep: pick(settings[WHEEL_SWEEP_SETTING], SWEEPS, 'counterclockwise'),
    houseWedgeStyle: pick(settings[HOUSE_WEDGE_STYLE_SETTING], HOUSE_WEDGE_STYLES, 'equal-degree'),
    signWedgeStyle: pick(settings[SIGN_WEDGE_STYLE_SETTING], SIGN_WEDGE_STYLES, 'default'),
  };
}
