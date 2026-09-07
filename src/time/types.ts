/**
 * Types for resolving a birth moment.
 *
 * Getting from "born 15 June 1960, 2:30pm, Vevay Indiana" to an instant on the
 * timeline is the highest-leverage correctness work in Astraya. A one-hour error
 * moves the Ascendant by about 15 degrees, which is a different rising sign and a
 * different chart — and it looks entirely plausible on screen.
 */

/** A wall-clock date and time, with no zone attached. What a person was told. */
export interface CivilDateTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Which calendar the written date is in.
 *
 * `auto` reads dates before the Gregorian reform (15 October 1582) as Julian. It
 * must stay overridable: Russia used the Julian calendar until 1918 and Greece
 * until 1923, so a date written in 1900 may be either.
 */
export type Calendar = 'gregorian' | 'julian' | 'auto';

/** How the UTC offset was arrived at. Always shown to the user. */
export type OffsetProvenance =
  /** The user stated the offset. Always wins. */
  | 'manual'
  /** IANA tzdb, evaluated at the birth instant. */
  | 'tzdb'
  /** Local Mean Time from longitude, for dates before standard time existed. */
  | 'lmt';

export type TimeWarningCode =
  /** The local time occurred twice — a DST fall-back overlap. */
  | 'ambiguous-local-time'
  /** The local time never occurred — a DST spring-forward gap. */
  | 'nonexistent-local-time'
  /** Coordinates sit near a zone boundary where neighbours disagree on the offset. */
  | 'zone-boundary'
  /** Local Mean Time was used because tzdb has no standard time for this date. */
  | 'lmt-used'
  /** The coordinate resolved to an `Etc/*` zone, which means open water. */
  | 'ocean-coordinates'
  /** The date was read in the Julian calendar. */
  | 'julian-calendar';

export interface TimeWarning {
  readonly code: TimeWarningCode;
  /** Written for the person entering the data, not for a developer. */
  readonly message: string;
}

export interface BirthMomentInput {
  readonly civil: CivilDateTime;
  readonly coordinates: Coordinates;
  /**
   * Minutes east of UTC, stated by the user. Birth certificates often record the
   * offset, and it is the only reliable answer for a wartime zone or a county
   * whose boundary a polygon lookup gets wrong.
   */
  readonly offsetOverrideMinutes?: number;
  /** Overrides the coordinate lookup. Useful when the lookup picks a neighbour. */
  readonly zoneOverride?: string;
  readonly calendar?: Calendar;
}

export interface ResolvedMoment {
  /**
   * The wall-clock time this resolution is *for*.
   *
   * Carried rather than left to the caller to keep alongside: an offset is
   * meaningless without the local time it applies to, and a function taking the two
   * separately can be handed a mismatched pair that produces a plausible wrong
   * instant. Keeping them in one value makes that unrepresentable.
   */
  readonly civil: CivilDateTime;
  /** Minutes east of UTC. Local time minus this offset is UTC. */
  readonly offsetMinutes: number;
  readonly provenance: OffsetProvenance;
  /** The IANA zone used, or null when the offset came from longitude or the user. */
  readonly zone: string | null;
  /** Which calendar the input date was read in, after resolving `auto`. */
  readonly calendar: 'gregorian' | 'julian';
  /**
   * Offsets that would also have produced the stated local time. Non-empty only
   * for a DST fall-back overlap, where the wall clock is genuinely ambiguous and
   * no amount of care can decide it — only the user can.
   */
  readonly alternativeOffsetMinutes: readonly number[];
  readonly warnings: readonly TimeWarning[];
  /**
   * The tzdb version that produced this offset.
   *
   * Recorded because historical offsets are *data*, and the data changes: this
   * project has already measured Node's ICU (2026a) and the host tzdb (2026c)
   * disagreeing with each other's predecessors on the same instant. A stored
   * chart must not move under the user because a tzdb update shipped, so the
   * resolved offset is persisted alongside the input and this fingerprint says
   * what produced it.
   */
  readonly tzdbFingerprint: string;
}
