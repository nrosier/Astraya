/**
 * Pure logic for the electional screen (#409): reading its form into a search, and turning a
 * window into the text the table shows. Kept apart from `ElectionalView.tsx` so what a typo does
 * is testable without a DOM or an ephemeris.
 */
import type { ElectionRuleKey, ElectionWindow } from '../astrology/electional.js';
import type { GeoPosition } from '../ephemeris/types.js';
import { civilFromJulianDay } from '../time/julian.js';
import { parseLatitude, parseLongitude } from './place-fields.js';

/** Longest span searched at once: a month of hourly samples is already hundreds of windows. */
export const MAX_ELECTION_SPAN_DAYS = 31;

/** The sampling steps offered, in minutes. */
export const ELECTION_STEP_MINUTES: readonly number[] = [30, 60, 120];

export interface ElectionFields {
  /** `YYYY-MM-DD` (UTC), the first day searched. */
  readonly fromDate: string;
  /** `YYYY-MM-DD` (UTC), the last day searched, inclusive. */
  readonly toDate: string;
  readonly latitude: string;
  readonly longitude: string;
  readonly rules: ReadonlySet<ElectionRuleKey>;
}

export type ElectionFieldError = 'fromDate' | 'toDate' | 'span' | 'order' | 'latitude' | 'longitude' | 'rules';

export interface ElectionSearch {
  readonly from: { readonly year: number; readonly month: number; readonly day: number };
  /** The day after the last day searched, so the whole of `toDate` is covered. */
  readonly to: { readonly year: number; readonly month: number; readonly day: number };
  readonly place: GeoPosition;
  readonly rules: ReadonlySet<ElectionRuleKey>;
}

export type ParsedElectionFields =
  { readonly ok: true; readonly search: ElectionSearch } | { readonly ok: false; readonly error: ElectionFieldError };

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

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

const MS_PER_DAY = 86_400_000;

/** The search the form describes, or the first thing wrong with it, in the order the form lists its fields. */
export function parseElectionFields(fields: ElectionFields): ParsedElectionFields {
  const from = parseDate(fields.fromDate);
  if (from === undefined) return { ok: false, error: 'fromDate' };
  const to = parseDate(fields.toDate);
  if (to === undefined) return { ok: false, error: 'toDate' };
  const fromMs = Date.UTC(from.year, from.month - 1, from.day);
  const toMs = Date.UTC(to.year, to.month - 1, to.day);
  if (toMs < fromMs) return { ok: false, error: 'order' };
  const days = (toMs - fromMs) / MS_PER_DAY + 1;
  if (days > MAX_ELECTION_SPAN_DAYS) return { ok: false, error: 'span' };
  const latitude = parseLatitude(fields.latitude);
  if (latitude === undefined) return { ok: false, error: 'latitude' };
  const longitude = parseLongitude(fields.longitude);
  if (longitude === undefined) return { ok: false, error: 'longitude' };
  if (fields.rules.size === 0) return { ok: false, error: 'rules' };

  const next = new Date(toMs + MS_PER_DAY);
  return {
    ok: true,
    search: {
      from,
      to: { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() },
      place: { latitude, longitude, altitude: 0 },
      rules: fields.rules,
    },
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** `2024-03-08 19:00` in UTC. */
export function formatUtcMinute(jd: number): string {
  const c = civilFromJulianDay(jd);
  return `${String(c.year)}-${pad2(c.month)}-${pad2(c.day)} ${pad2(c.hour)}:${pad2(c.minute)}`;
}

/** `3 h 30 min`, `45 min`, `2 d 1 h`: how long a window lasts, rounded to the minute. */
export function formatDuration(days: number): string {
  const totalMinutes = Math.round(days * 1440);
  const d = Math.floor(totalMinutes / 1440);
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${String(d)} d`);
  if (h > 0) parts.push(`${String(h)} h`);
  if (m > 0 && d === 0) parts.push(`${String(m)} min`);
  return parts.length === 0 ? '0 min' : parts.join(' ');
}

export interface ElectionRow {
  readonly id: string;
  readonly startJd: number;
  readonly endJd: number;
  readonly start: string;
  readonly end: string;
  readonly duration: string;
  readonly satisfied: readonly ElectionRuleKey[];
  readonly violated: readonly ElectionRuleKey[];
}

export function electionRows(windows: readonly ElectionWindow[]): readonly ElectionRow[] {
  return windows.map((window) => ({
    id: String(window.startJd),
    startJd: window.startJd,
    endJd: window.endJd,
    start: formatUtcMinute(window.startJd),
    end: formatUtcMinute(window.endJd),
    duration: formatDuration(window.endJd - window.startJd),
    satisfied: window.satisfied,
    violated: window.violated,
  }));
}
