/**
 * A person: the primary entity, and the owner of birth data.
 *
 * Everything the app computes comes from one of these. A chart is derived, so a person
 * is the only thing that has to be stored correctly.
 *
 * Two decisions here are worth reading before changing anything.
 *
 * **The stored record is the input, not the resolution.** A person holds what someone
 * typed — civil time, coordinates, an optional stated offset — and *not* a resolved
 * UTC offset as its source of truth. Historical offsets are data, and the data changes:
 * this project has measured two tzdb versions disagreeing about the same 1960 instant.
 * If the resolution were the stored truth, a chart could never be recomputed; if it
 * were absent, a tzdb update would move someone's Ascendant with no warning. So the
 * resolution is stored *as a witness* — the offset, the zone, and the tzdb version that
 * produced it — which is enough to notice the disagreement and say so (#20).
 *
 * **A field this build cannot read is absent, never defaulted.** Coordinates in
 * particular: `{0, 0}` is a real place in the Gulf of Guinea, and a chart cast there
 * looks entirely plausible. So a person whose birth moment did not survive validation
 * has no moment at all and lists what is missing, rather than being quietly charted
 * somewhere nobody was born.
 */
import type { BirthMomentInput, Calendar, CivilDateTime, Coordinates } from '../time/types.js';

/**
 * How well the birth time is known.
 *
 * This is not a footnote. Houses, the Ascendant and the Midheaven move about 15° an
 * hour, so with an unknown time they are not approximations — they are meaningless, and
 * the app must refuse to present them rather than draw a noon chart that looks like
 * every other chart.
 */
export type TimeAccuracy =
  /** From a birth certificate or hospital record. */
  | 'recorded'
  /** Reported by family. Usually rounded, often to a plausible-sounding number. */
  | 'remembered'
  /** Known only loosely — "early morning", "around teatime". */
  | 'approximate'
  /** Not known at all. Houses and angles are unusable, not merely uncertain. */
  | 'unknown';

const TIME_ACCURACIES: readonly TimeAccuracy[] = ['recorded', 'remembered', 'approximate', 'unknown'];

/**
 * What a past resolution said, and what produced it.
 *
 * Never read as the offset to use — it is compared against a fresh resolution so that a
 * change in the timezone database becomes a visible warning instead of a silent shift.
 */
export interface OffsetWitness {
  readonly offsetMinutes: number;
  readonly zone: string | null;
  readonly tzdbFingerprint: string;
}

export interface Person {
  readonly id: string;
  /** May be empty: a person can be created before there is anything to call them. */
  readonly displayName: string;
  /**
   * Absent when the stored birth data was incomplete or unreadable. Callers that need
   * to cast a chart must handle that rather than substitute a default.
   */
  readonly moment?: BirthMomentInput;
  /** What the user typed for the place. Free text: no geocoding, so this is a label only. */
  readonly placeLabel: string;
  readonly timeAccuracy: TimeAccuracy;
  readonly notes: string;
  readonly witness?: OffsetWitness;
  /** Field names that are required for a chart and are missing or unreadable. */
  readonly missing: readonly string[];
}

/** The register names a person is assembled from. The log's vocabulary for this entity. */
export const PERSON_FIELDS = [
  'displayName',
  'civil',
  'coordinates',
  'calendar',
  'offsetOverrideMinutes',
  'zoneOverride',
  'placeLabel',
  'timeAccuracy',
  'notes',
  'witness',
] as const;

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Read a civil date and time.
 *
 * Ranges are checked, but calendar validity deliberately is not: 30 February is
 * rejected by nobody here, because the Julian calendar, the Gregorian reform gap and
 * proleptic dates all make "is this a real date" a question for the ephemeris boundary
 * rather than for a field validator (`src/time/julian.ts`).
 */
export function readCivil(value: unknown): CivilDateTime | undefined {
  if (!isRecordValue(value)) return undefined;
  const { year, month, day, hour, minute, second } = value;
  if (![year, month, day, hour, minute, second].every((part) => isFiniteNumber(part) && Number.isInteger(part))) {
    return undefined;
  }
  const civil = value as unknown as CivilDateTime;
  if (civil.month < 1 || civil.month > 12 || civil.day < 1 || civil.day > 31) return undefined;
  if (civil.hour < 0 || civil.hour > 23 || civil.minute < 0 || civil.minute > 59) return undefined;
  // 60 is allowed: a leap second is a real wall-clock reading, and refusing it would
  // reject a birth recorded at 23:59:60 on one of the 27 days it has happened.
  if (civil.second < 0 || civil.second > 60) return undefined;
  return civil;
}

export function readCoordinates(value: unknown): Coordinates | undefined {
  if (!isRecordValue(value)) return undefined;
  const { latitude, longitude } = value;
  if (!isFiniteNumber(latitude) || !isFiniteNumber(longitude)) return undefined;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return undefined;
  return { latitude, longitude };
}

export function readCalendar(value: unknown): Calendar | undefined {
  return value === 'gregorian' || value === 'julian' || value === 'auto' ? value : undefined;
}

export function readTimeAccuracy(value: unknown): TimeAccuracy | undefined {
  return TIME_ACCURACIES.find((accuracy) => accuracy === value);
}

export function readWitness(value: unknown): OffsetWitness | undefined {
  if (!isRecordValue(value)) return undefined;
  const { offsetMinutes, zone, tzdbFingerprint } = value;
  if (!isFiniteNumber(offsetMinutes)) return undefined;
  if (zone !== null && typeof zone !== 'string') return undefined;
  if (typeof tzdbFingerprint !== 'string' || tzdbFingerprint === '') return undefined;
  return { offsetMinutes, zone, tzdbFingerprint };
}

/** An offset override, in minutes east of UTC. */
export function readOffsetOverride(value: unknown): number | undefined {
  // Bounded well outside any real zone but not at ±12h: Kiribati moved to +14, and
  // Local Mean Time at the date line is further out still.
  return isFiniteNumber(value) && Math.abs(value) <= 18 * 60 ? value : undefined;
}

export function readText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Assemble a person from field values, reporting what is unusable.
 *
 * Takes already-read register values rather than the log, so it can be tested — and so
 * the fold owns ordering while this owns meaning.
 */
export function buildPerson(id: string, fields: ReadonlyMap<string, unknown>): Person {
  const civil = readCivil(fields.get('civil'));
  const coordinates = readCoordinates(fields.get('coordinates'));
  const calendar = readCalendar(fields.get('calendar'));
  const zoneOverride = readText(fields.get('zoneOverride'));
  const offsetOverrideMinutes = readOffsetOverride(fields.get('offsetOverrideMinutes'));
  const witness = readWitness(fields.get('witness'));

  const missing: string[] = [];
  if (civil === undefined) missing.push('civil');
  if (coordinates === undefined) missing.push('coordinates');

  const moment: BirthMomentInput | undefined =
    civil === undefined || coordinates === undefined
      ? undefined
      : {
          civil,
          coordinates,
          // Spread rather than assign: `exactOptionalPropertyTypes` distinguishes an
          // absent optional field from one set to undefined, and so does the log — a
          // calendar nobody chose is not the same as one chosen and cleared.
          ...(calendar === undefined ? {} : { calendar }),
          ...(zoneOverride === undefined ? {} : { zoneOverride }),
          ...(offsetOverrideMinutes === undefined ? {} : { offsetOverrideMinutes }),
        };

  return {
    id,
    displayName: readText(fields.get('displayName')) ?? '',
    ...(moment === undefined ? {} : { moment }),
    placeLabel: readText(fields.get('placeLabel')) ?? '',
    timeAccuracy: readTimeAccuracy(fields.get('timeAccuracy')) ?? 'unknown',
    notes: readText(fields.get('notes')) ?? '',
    ...(witness === undefined ? {} : { witness }),
    missing,
  };
}
