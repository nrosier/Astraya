/**
 * A birth moment as URL parameters.
 *
 * Sharing a chart by link is a first-class feature, and a link is also the only
 * copy of the data for someone who never signs in and clears their browser. So the
 * encoding is deliberately legible — `?d=1960-06-15&t=14:30&la=38.7478` rather than
 * a packed base64 blob. A user can read it, spot a wrong digit, and fix it by hand,
 * and we can debug a bug report from the URL alone.
 *
 * The offset override round-trips. That matters more than it looks: an override is
 * the user telling us the lookup is wrong, and a link that silently dropped it
 * would hand the recipient a different chart from the one that was shared.
 */
import type { BirthMomentInput, Calendar } from './types.js';

const CALENDARS: readonly Calendar[] = ['gregorian', 'julian', 'auto'];

function pad(value: number, width = 2): string {
  return String(Math.trunc(Math.abs(value))).padStart(width, '0');
}

/** `1960-06-15`, with a leading `-` for BCE years. */
function encodeDate(year: number, month: number, day: number): string {
  const sign = year < 0 ? '-' : '';
  return `${sign}${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** `14:30` or `14:30:07` — seconds omitted when zero, since most records lack them. */
function encodeTime(hour: number, minute: number, second: number): string {
  const base = `${pad(hour)}:${pad(minute)}`;
  return second === 0 ? base : `${base}:${pad(second)}`;
}

export function encodeBirthMoment(input: BirthMomentInput): URLSearchParams {
  const { civil, coordinates } = input;
  const params = new URLSearchParams();
  params.set('d', encodeDate(civil.year, civil.month, civil.day));
  params.set('t', encodeTime(civil.hour, civil.minute, civil.second));
  params.set('la', String(coordinates.latitude));
  params.set('lo', String(coordinates.longitude));
  if (input.offsetOverrideMinutes !== undefined) params.set('off', String(input.offsetOverrideMinutes));
  if (input.zoneOverride !== undefined) params.set('tz', input.zoneOverride);
  // `auto` is the default, so omitting it keeps the common link short.
  if (input.calendar !== undefined && input.calendar !== 'auto') params.set('cal', input.calendar);
  return params;
}

/** Thrown when a link cannot be read, naming the parameter at fault. */
export class BirthMomentLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BirthMomentLinkError';
  }
}

function requireParam(params: URLSearchParams, key: string, what: string): string {
  const value = params.get(key);
  if (value === null || value === '') throw new BirthMomentLinkError(`This link is missing its ${what} (\`${key}\`).`);
  return value;
}

function finiteNumber(raw: string, key: string, what: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new BirthMomentLinkError(`\`${key}\` is not a valid ${what}: "${raw}".`);
  return value;
}

const DATE = /^(-?)(\d{1,6})-(\d{1,2})-(\d{1,2})$/;
const TIME = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;

export function decodeBirthMoment(params: URLSearchParams): BirthMomentInput {
  const dateMatch = DATE.exec(requireParam(params, 'd', 'date'));
  if (dateMatch === null) throw new BirthMomentLinkError('`d` must look like `1960-06-15`.');
  const timeMatch = TIME.exec(requireParam(params, 't', 'time'));
  if (timeMatch === null) throw new BirthMomentLinkError('`t` must look like `14:30` or `14:30:07`.');

  const [, sign = '', y = '0', mo = '1', d = '1'] = dateMatch;
  const [, h = '0', mi = '0', s = '0'] = timeMatch;
  const year = Number(`${sign}${y}`);
  const civil = {
    year,
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(s),
  };
  if (civil.month < 1 || civil.month > 12)
    throw new BirthMomentLinkError(`Month ${String(civil.month)} is not a month.`);
  if (civil.day < 1 || civil.day > 31) throw new BirthMomentLinkError(`Day ${String(civil.day)} is not a day.`);
  // 24:00 is rejected rather than normalised: it is ambiguous about which date is
  // meant, and guessing would silently move a birth by a day.
  if (civil.hour > 23) throw new BirthMomentLinkError(`Hour ${String(civil.hour)} is not an hour of the day.`);
  if (civil.minute > 59 || civil.second > 59) throw new BirthMomentLinkError('Minutes and seconds must be under 60.');

  const latitude = finiteNumber(requireParam(params, 'la', 'latitude'), 'la', 'latitude');
  const longitude = finiteNumber(requireParam(params, 'lo', 'longitude'), 'lo', 'longitude');
  if (latitude < -90 || latitude > 90)
    throw new BirthMomentLinkError(`Latitude ${String(latitude)} is outside -90..90.`);
  if (longitude < -180 || longitude > 180) {
    throw new BirthMomentLinkError(`Longitude ${String(longitude)} is outside -180..180.`);
  }

  const rawOffset = params.get('off');
  const rawZone = params.get('tz');
  const rawCalendar = params.get('cal');
  if (rawCalendar !== null && !CALENDARS.includes(rawCalendar as Calendar)) {
    throw new BirthMomentLinkError(`\`cal\` must be one of ${CALENDARS.join(', ')}, not "${rawCalendar}".`);
  }

  return {
    civil,
    coordinates: { latitude, longitude },
    // Spread-conditionally rather than assigning undefined: exactOptionalPropertyTypes
    // distinguishes an absent property from one explicitly set to undefined, and an
    // absent override is what "no override" means.
    ...(rawOffset === null || rawOffset === ''
      ? {}
      : { offsetOverrideMinutes: finiteNumber(rawOffset, 'off', 'offset in minutes') }),
    ...(rawZone === null || rawZone === '' ? {} : { zoneOverride: rawZone }),
    ...(rawCalendar === null ? {} : { calendar: rawCalendar as Calendar }),
  };
}
