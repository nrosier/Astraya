/**
 * Pure logic for the horary screen (#406): turning the form's four text fields into the moment a
 * chart is cast for, and the defaults the form opens on. Kept apart from `HoraryView.tsx` so the
 * parsing — which decides what a typo does — is testable without a DOM.
 */
import type { BirthMomentInput } from '../time/types.js';

export interface HoraryFields {
  /** `YYYY-MM-DD`, as `<input type="date">` produces. */
  readonly date: string;
  /** `HH:MM`, as `<input type="time">` produces. */
  readonly time: string;
  readonly latitude: string;
  readonly longitude: string;
}

export type HoraryFieldError = 'date' | 'time' | 'latitude' | 'longitude';

export type ParsedHoraryFields =
  { readonly ok: true; readonly moment: BirthMomentInput } | { readonly ok: false; readonly field: HoraryFieldError };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DECIMAL_PATTERN = /^-?\d+(?:[.,]\d+)?$/;

/** A decimal typed with either `.` or `,` (a Dutch keyboard's), or `undefined` if it is not a plain number. */
function parseDecimal(text: string): number | undefined {
  const trimmed = text.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return undefined;
  return Number(trimmed.replace(',', '.'));
}

/** True when `year-month-day` names a real calendar day (so 2024-02-30 is rejected, not rolled into March). */
function isRealDate(year: number, month: number, day: number): boolean {
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * The moment the question was asked, from the form's fields — as a local civil time at the place,
 * whose zone `resolveMoment` then finds from the coordinates. The first field that does not parse
 * is reported, so the form can point at it.
 */
export function parseHoraryFields(fields: HoraryFields): ParsedHoraryFields {
  const date = DATE_PATTERN.exec(fields.date.trim());
  const year = Number(date?.[1]);
  const month = Number(date?.[2]);
  const day = Number(date?.[3]);
  if (date === null || !isRealDate(year, month, day)) return { ok: false, field: 'date' };

  const time = TIME_PATTERN.exec(fields.time.trim());
  const hour = Number(time?.[1]);
  const minute = Number(time?.[2]);
  const second = Number(time?.[3] ?? 0);
  if (time === null || hour > 23 || minute > 59 || second > 59) return { ok: false, field: 'time' };

  const latitude = parseDecimal(fields.latitude);
  if (latitude === undefined || latitude < -90 || latitude > 90) return { ok: false, field: 'latitude' };
  const longitude = parseDecimal(fields.longitude);
  if (longitude === undefined || longitude < -180 || longitude > 180) return { ok: false, field: 'longitude' };

  return {
    ok: true,
    moment: { civil: { year, month, day, hour, minute, second }, coordinates: { latitude, longitude } },
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** The form's opening date and time: now, in the browser's own local time. */
export function nowFields(now: Date = new Date()): Pick<HoraryFields, 'date' | 'time'> {
  return {
    date: `${String(now.getFullYear())}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
  };
}

/** The house systems offered, by Swiss Ephemeris code. The first is the horary tradition's. */
export const HORARY_HOUSE_SYSTEMS: readonly string[] = ['R', 'P', 'W'];
