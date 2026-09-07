/**
 * The birth-data form, as data (#45).
 *
 * Every rule about what makes a birth record acceptable lives here, in pure functions
 * over strings, rather than inside a React component. Two reasons, both practical:
 *
 *  - The rules are the part that can be wrong in a way nobody notices. A latitude of 95°
 *    or a February 30th has to be caught with a message, not coerced into something
 *    plausible, and that deserves tests rather than a click-through.
 *  - The draft is strings because that is what the user typed. Parsing at the boundary and
 *    keeping the raw text until it validates means a half-typed "-" in a longitude field
 *    is a work in progress, not a coordinate of zero.
 *
 * The other decision worth stating: saving writes **only the fields that changed**. A save
 * that wrote all eleven fields would produce eleven operations where one was needed, and —
 * worse — would stamp the untouched ten with a newer timestamp, so a save on this device
 * would silently overwrite a note another device had edited in the meantime. Fields the
 * user did not touch must keep whatever timestamp they already had.
 */
import type { Person, TimeAccuracy } from './person.js';
import type { BirthMomentInput, Calendar } from '../time/types.js';
import type { Mutation } from '../store/oplog.js';
import type { JsonValue } from '../store/ops.js';

/** Exactly what the form holds: text, plus the two closed choices that are real menus. */
export interface Draft {
  readonly displayName: string;
  /** `YYYY-MM-DD`, as an `<input type="date">` produces. */
  readonly date: string;
  /** `HH:MM` or `HH:MM:SS`. */
  readonly time: string;
  readonly timeAccuracy: TimeAccuracy;
  readonly latitude: string;
  readonly longitude: string;
  readonly placeLabel: string;
  readonly calendar: Calendar;
  /** Minutes east of UTC. Empty means "use the lookup"; `0` means UTC. */
  readonly offsetOverride: string;
  readonly zoneOverride: string;
  readonly notes: string;
}

export const EMPTY_DRAFT: Draft = {
  displayName: '',
  date: '',
  time: '',
  timeAccuracy: 'recorded',
  latitude: '',
  longitude: '',
  placeLabel: '',
  calendar: 'auto',
  offsetOverride: '',
  zoneOverride: '',
  notes: '',
};

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Fill a draft from a stored person, so editing starts from what is on record. */
export function draftFrom(person: Person): Draft {
  const moment = person.moment;
  const civil = moment?.civil;
  return {
    displayName: person.displayName,
    date: civil === undefined ? '' : `${pad(civil.year, 4)}-${pad(civil.month)}-${pad(civil.day)}`,
    time: civil === undefined ? '' : `${pad(civil.hour)}:${pad(civil.minute)}:${pad(civil.second)}`,
    timeAccuracy: person.timeAccuracy,
    latitude: moment === undefined ? '' : String(moment.coordinates.latitude),
    longitude: moment === undefined ? '' : String(moment.coordinates.longitude),
    placeLabel: person.placeLabel,
    calendar: moment?.calendar ?? 'auto',
    offsetOverride: moment?.offsetOverrideMinutes === undefined ? '' : String(moment.offsetOverrideMinutes),
    zoneOverride: moment?.zoneOverride ?? '',
    notes: person.notes,
  };
}

/** Field name to message. A field with no entry here is acceptable as typed. */
export type DraftErrors = Readonly<Partial<Record<keyof Draft, string>>>;

export interface Validated {
  readonly errors: DraftErrors;
  /**
   * The birth moment, when the draft describes one.
   *
   * Absent whenever anything it needs is missing or wrong — never a partially filled
   * moment, because half a coordinate pair is a place nobody was born.
   */
  readonly moment?: BirthMomentInput;
}

const DATE = /^(-?\d{1,6})-(\d{2})-(\d{2})$/;
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** Days in a month, Gregorian and Julian leap rules both. */
function daysInMonth(year: number, month: number, calendar: Calendar): number {
  if (month !== 2) return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 31;
  // The Julian calendar has a leap year every fourth year with no century rule, so 1900
  // was a leap year in it and not in the Gregorian one. `auto` is resolved by the same
  // reform date the ephemeris boundary uses, so the form and the calculation agree about
  // which calendar a date is in.
  const julian = calendar === 'julian' || (calendar === 'auto' && year < 1582);
  const leap = julian ? year % 4 === 0 : year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return leap ? 29 : 28;
}

export function validateDraft(draft: Draft): Validated {
  const errors: Record<string, string> = {};

  if (draft.displayName.trim() === '') {
    errors.displayName = 'A name is needed, even a placeholder — it is how you will find this person again.';
  }

  const dateMatch = DATE.exec(draft.date.trim());
  let year = 0;
  let month = 0;
  let day = 0;
  if (draft.date.trim() === '') {
    errors.date = 'A birth date is required.';
  } else if (dateMatch?.[1] === undefined || dateMatch[2] === undefined || dateMatch[3] === undefined) {
    errors.date = 'Give the date as YYYY-MM-DD.';
  } else {
    year = Number(dateMatch[1]);
    month = Number(dateMatch[2]);
    day = Number(dateMatch[3]);
    if (year === 0) {
      // There is no year zero in either calendar; astronomers use one, historians do not.
      // Refusing it is better than silently deciding which convention the user meant.
      errors.date = 'There is no year 0. Use 1 BC as -1 if you mean the year before 1 AD.';
    } else if (month < 1 || month > 12) {
      errors.date = 'The month must be between 1 and 12.';
    } else if (day < 1 || day > daysInMonth(year, month, draft.calendar)) {
      errors.date = `${pad(year, 4)}-${pad(month)} has ${String(daysInMonth(year, month, draft.calendar))} days.`;
    }
  }

  // An unknown birth time is a real state, not a missing field. Houses, angles and
  // anything derived from them are meaningless without it — which is why the accuracy is
  // recorded rather than the time being quietly filled in with noon.
  const timeRequired = draft.timeAccuracy !== 'unknown';
  const timeMatch = TIME.exec(draft.time.trim());
  let hour = 0;
  let minute = 0;
  let second = 0;
  if (draft.time.trim() === '') {
    if (timeRequired) errors.time = 'A birth time is required. Choose “Time unknown” if there is none on record.';
  } else if (timeMatch?.[1] === undefined || timeMatch[2] === undefined) {
    errors.time = 'Give the time as HH:MM, on a 24-hour clock.';
  } else {
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2]);
    second = Number(timeMatch[3] ?? '0');
    if (hour > 23) errors.time = 'The hour must be between 0 and 23.';
    else if (minute > 59) errors.time = 'The minute must be between 0 and 59.';
    // 60 is allowed: a leap second is a real reading off a real wall clock.
    else if (second > 60) errors.time = 'The second must be between 0 and 60.';
  }

  const latitude = number(draft.latitude);
  if (latitude === undefined) errors.latitude = 'A latitude is required, in decimal degrees.';
  else if (latitude < -90 || latitude > 90) errors.latitude = 'Latitude runs from -90 (south) to 90 (north).';

  const longitude = number(draft.longitude);
  if (longitude === undefined) errors.longitude = 'A longitude is required, in decimal degrees.';
  else if (longitude < -180 || longitude > 180) errors.longitude = 'Longitude runs from -180 (west) to 180 (east).';

  let offsetOverrideMinutes: number | undefined;
  if (draft.offsetOverride.trim() !== '') {
    const parsed = number(draft.offsetOverride);
    if (parsed === undefined) errors.offsetOverride = 'Give the offset in minutes east of UTC, such as -300.';
    // Not ±12 hours: Kiribati moved to +14, and historical offsets have been stranger.
    else if (parsed < -18 * 60 || parsed > 18 * 60)
      errors.offsetOverride = 'An offset must be within ±18 hours of UTC.';
    else offsetOverrideMinutes = parsed;
  }

  if (Object.keys(errors).length > 0 || latitude === undefined || longitude === undefined) {
    return { errors };
  }

  return {
    errors,
    moment: {
      civil: { year, month, day, hour, minute, second },
      coordinates: { latitude, longitude },
      ...(draft.calendar === 'auto' ? {} : { calendar: draft.calendar }),
      ...(offsetOverrideMinutes === undefined ? {} : { offsetOverrideMinutes }),
      ...(draft.zoneOverride.trim() === '' ? {} : { zoneOverride: draft.zoneOverride.trim() }),
    },
  };
}

/** Parse a decimal number, rejecting the empty string and anything non-finite. */
function number(raw: string): number | undefined {
  const text = raw.trim();
  if (text === '') return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The operations a save should write: one per field that actually changed.
 *
 * `previous` is the draft the form opened with. Comparing against it rather than against
 * the stored person keeps this honest about what the *user* changed, and means a field
 * nobody touched keeps the timestamp it already had — so saving here cannot overwrite a
 * note another device edited while this form was open.
 */
export function draftToMutations(entityId: string, draft: Draft, previous: Draft = EMPTY_DRAFT): readonly Mutation[] {
  const validated = validateDraft(draft);
  if (validated.moment === undefined) throw new Error('refusing to write a draft that does not validate');
  const before = validateDraft(previous);
  const mutations: Mutation[] = [];
  const write = (field: string, value: JsonValue): void => {
    mutations.push({ entity: 'person', entityId, field, value });
  };

  if (draft.displayName.trim() !== previous.displayName.trim()) write('displayName', draft.displayName.trim());
  if (draft.placeLabel.trim() !== previous.placeLabel.trim()) write('placeLabel', draft.placeLabel.trim());
  if (draft.notes !== previous.notes) write('notes', draft.notes);
  if (draft.timeAccuracy !== previous.timeAccuracy) write('timeAccuracy', draft.timeAccuracy);
  if (draft.calendar !== previous.calendar) write('calendar', draft.calendar);
  if (draft.zoneOverride.trim() !== previous.zoneOverride.trim()) write('zoneOverride', draft.zoneOverride.trim());

  // This register has to be able to hold "no override", which is not the same as an
  // override of zero — zero is UTC. Clearing the field therefore writes `null`, which the
  // reader rejects as a number and so treats as absent. Writing 0 would move a chart by up
  // to a day; writing nothing at all would leave the old override in force.
  if (draft.offsetOverride.trim() !== previous.offsetOverride.trim()) {
    write('offsetOverrideMinutes', validated.moment.offsetOverrideMinutes ?? null);
  }

  // Date, time and coordinates are three registers, not nine. A hybrid of two devices'
  // coordinates is a place nobody was born, and a date built half from one edit and half
  // from another is a moment that never happened — so each is written whole or not at all.
  const civil = validated.moment.civil;
  if (!sameCivil(civil, before.moment?.civil)) write('civil', { ...civil });

  const coordinates = validated.moment.coordinates;
  if (!sameCoordinates(coordinates, before.moment?.coordinates)) write('coordinates', { ...coordinates });

  return mutations;
}

/** Comparisons treat "there was nothing before" as different, so a first save writes. */
function sameCivil(a: BirthMomentInput['civil'], b: BirthMomentInput['civil'] | undefined): boolean {
  if (b === undefined) return false;
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.second === b.second
  );
}

function sameCoordinates(a: BirthMomentInput['coordinates'], b: BirthMomentInput['coordinates'] | undefined): boolean {
  if (b === undefined) return false;
  return a.latitude === b.latitude && a.longitude === b.longitude;
}
