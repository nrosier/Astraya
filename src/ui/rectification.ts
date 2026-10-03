/**
 * Pure logic for the rectification screen (#408): reading its form into a search request, and the
 * wording of a contact. Kept apart from `RectificationView.tsx` so what a typo does is testable
 * without a DOM or an ephemeris.
 */
import type { RectificationRequest } from '../domain/rectification.js';
import { parseLatitude, parseLongitude } from './place-fields.js';

export const RECTIFICATION_STEP_MINUTES: readonly number[] = [1, 2, 5, 10, 15];

export interface EventField {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly label: string;
}

export interface RectificationFields {
  /** `YYYY-MM-DD`, the birth date. */
  readonly birthDate: string;
  /** `HH:MM`, the earliest candidate time. */
  readonly fromTime: string;
  /** `HH:MM`, the latest candidate time. */
  readonly toTime: string;
  readonly stepMinutes: number;
  readonly latitude: string;
  readonly longitude: string;
  readonly events: readonly EventField[];
  /** Carried over from a chosen person, so their own zone setting still applies. */
  readonly zoneOverride?: string;
  readonly offsetOverrideMinutes?: number;
}

export type RectificationFieldError =
  | { readonly field: 'birthDate' | 'fromTime' | 'toTime' | 'order' | 'latitude' | 'longitude' | 'events' }
  | { readonly field: 'eventDate' | 'eventBeforeBirth'; readonly index: number };

export type ParsedRectificationFields =
  | {
      readonly ok: true;
      readonly request: Omit<RectificationRequest, 'events'>;
      readonly events: readonly EventField[];
    }
  | { readonly ok: false; readonly error: RectificationFieldError };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

function parseDate(text: string): { year: number; month: number; day: number } | undefined {
  const match = DATE_PATTERN.exec(text.trim());
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  const real = probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
  return real ? { year, month, day } : undefined;
}

/** Minutes after midnight, or `undefined` for anything but a real `HH:MM`. */
function parseMinuteOfDay(text: string): number | undefined {
  const match = TIME_PATTERN.exec(text.trim());
  if (match === null) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour > 23 || minute > 59 ? undefined : hour * 60 + minute;
}

/**
 * The search the form describes, or the first thing wrong with it, in the order the form lists its
 * fields. The events come back as given (dates still text): turning each into a Julian day needs the
 * ephemeris, so the screen does that.
 */
export function parseRectificationFields(fields: RectificationFields): ParsedRectificationFields {
  const birth = parseDate(fields.birthDate);
  if (birth === undefined) return { ok: false, error: { field: 'birthDate' } };
  const fromMinute = parseMinuteOfDay(fields.fromTime);
  if (fromMinute === undefined) return { ok: false, error: { field: 'fromTime' } };
  const toMinute = parseMinuteOfDay(fields.toTime);
  if (toMinute === undefined) return { ok: false, error: { field: 'toTime' } };
  if (toMinute < fromMinute) return { ok: false, error: { field: 'order' } };
  const latitude = parseLatitude(fields.latitude);
  if (latitude === undefined) return { ok: false, error: { field: 'latitude' } };
  const longitude = parseLongitude(fields.longitude);
  if (longitude === undefined) return { ok: false, error: { field: 'longitude' } };

  const filled = fields.events.filter((event) => event.date.trim() !== '');
  if (filled.length === 0) return { ok: false, error: { field: 'events' } };
  for (const [index, event] of fields.events.entries()) {
    if (event.date.trim() === '') continue;
    const date = parseDate(event.date);
    if (date === undefined) return { ok: false, error: { field: 'eventDate', index } };
    // An event the day of birth or earlier has no age to direct by.
    const eventMs = Date.UTC(date.year, date.month - 1, date.day);
    if (eventMs <= Date.UTC(birth.year, birth.month - 1, birth.day)) {
      return { ok: false, error: { field: 'eventBeforeBirth', index } };
    }
  }

  return {
    ok: true,
    events: filled,
    request: {
      base: {
        civil: { year: birth.year, month: birth.month, day: birth.day, hour: 0, minute: 0, second: 0 },
        coordinates: { latitude, longitude },
        ...(fields.zoneOverride === undefined ? {} : { zoneOverride: fields.zoneOverride }),
        ...(fields.offsetOverrideMinutes === undefined ? {} : { offsetOverrideMinutes: fields.offsetOverrideMinutes }),
      },
      fromMinute,
      toMinute,
      stepMinutes: fields.stepMinutes,
    },
  };
}

/** `2020-06-15` → the same day at noon UTC, for an event whose time of day is unknown. */
export function eventNoonParts(text: string): { year: number; month: number; day: number } | undefined {
  return parseDate(text);
}
