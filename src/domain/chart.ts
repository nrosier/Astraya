/**
 * A chart: a view of a person, plus the settings that reproduce it.
 *
 * Charts hold no computed positions. Everything a wheel shows is recalculated from the
 * person's birth moment and these settings in a few milliseconds, so storing results
 * would only create a second version of the truth that could fall out of step with the
 * ephemeris. What is stored is exactly what is needed to get the same answer again.
 *
 * **Settings are kept verbatim, and unknown ones are kept too.** A chart made by a
 * newer build may name a house system this build has never heard of. Substituting a
 * default would silently show a different chart under the same name, so an unknown
 * setting is surfaced as unsupported instead — and, because the value is retained
 * untouched, the chart still renders correctly on the build that understands it.
 *
 * **Each setting is its own register**, written as a dotted field name
 * (`settings.houseSystem`). This is the opposite granularity from a person's birth
 * moment, on purpose: for coordinates a merged half-and-half value would be a place
 * nobody was born, so the moment is written whole; for settings a merge is harmless
 * and losing an unrelated change would just be annoying.
 */
import type { JsonValue } from '../store/ops.js';
import { isPersonId } from './id.js';

/**
 * Chart kinds this build understands.
 *
 * A list rather than a union type, because the vocabulary is open: M6 adds progressions
 * and returns, and a chart written by a newer build must survive being read here. A
 * renderer that cannot draw a kind says so; it does not fall back to a natal chart,
 * which would be a different chart shown under the wrong name.
 */
export const KNOWN_CHART_KINDS = ['natal'] as const;

export function isKnownChartKind(kind: string): boolean {
  return (KNOWN_CHART_KINDS as readonly string[]).includes(kind);
}

/** The prefix marking a chart-settings register. */
export const SETTINGS_PREFIX = 'settings.';

export interface Chart {
  readonly id: string;
  /** The person this chart is of. May name a person this device has not synced yet. */
  readonly personId: string;
  /** `natal`, or something a newer build invented. Never rewritten to a known value. */
  readonly kind: string;
  readonly label: string;
  /**
   * Everything needed to reproduce the chart, verbatim, including keys this build does
   * not recognise. The authority on which values are valid lives with the calculation
   * (M4), not here — a field validator that duplicated that list would drift from it.
   */
  readonly settings: Readonly<Record<string, JsonValue>>;
  /** Missing or unreadable fields without which the chart cannot be drawn. */
  readonly missing: readonly string[];
}

export const CHART_FIELDS = ['personId', 'kind', 'label'] as const;

/**
 * Assemble a chart from field values.
 *
 * A chart with no readable `personId` is not attached to anybody, and there is no
 * sensible guess to make — every chart is a chart *of* someone.
 */
export function buildChart(id: string, fields: ReadonlyMap<string, unknown>): Chart {
  const personId = fields.get('personId');
  const kind = fields.get('kind');
  const settings: Record<string, JsonValue> = {};
  for (const [field, value] of fields) {
    if (field.startsWith(SETTINGS_PREFIX)) settings[field.slice(SETTINGS_PREFIX.length)] = value as JsonValue;
  }

  const missing: string[] = [];
  if (!isPersonId(personId)) missing.push('personId');
  if (typeof kind !== 'string' || kind === '') missing.push('kind');

  return {
    id,
    personId: isPersonId(personId) ? personId : '',
    kind: typeof kind === 'string' && kind !== '' ? kind : '',
    label: typeof fields.get('label') === 'string' ? (fields.get('label') as string) : '',
    settings,
    missing,
  };
}
