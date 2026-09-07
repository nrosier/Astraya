/**
 * Resolve a stated birth moment to a UTC offset, with its provenance.
 *
 * The output deliberately carries more than a number. Where the wall clock is
 * genuinely ambiguous — a DST fall-back hour, a coordinate on a zone boundary,
 * a date before standard time — this returns the offset it used *and* says why,
 * *and* keeps the alternatives. The user is the only one who can settle those, so
 * hiding them behind a single confident number is the failure mode to avoid.
 *
 * Turning the offset into a Julian day is the ephemeris boundary's job, so that
 * delta-T, leap seconds and the calendar flag stay with Swiss Ephemeris rather
 * than being reimplemented here. See `src/time/julian.ts`.
 */
import {
  isFixedOffsetZone,
  localMeanTimeOffsetMinutes,
  lookupZone,
  offsetCandidates,
  offsetDisagreesNearby,
  tzdbFingerprint,
  useLocalMeanTime,
  zoneOffsetMinutes,
} from './zones.js';
import type { BirthMomentInput, Calendar, CivilDateTime, ResolvedMoment, TimeWarning } from './types.js';

/** The Gregorian reform: 4 October 1582 (Julian) was followed by 15 October. */
const GREGORIAN_REFORM = { year: 1582, month: 10, day: 15 } as const;

/** Resolve `auto` against the Gregorian reform date. */
export function resolveCalendar(civil: CivilDateTime, calendar: Calendar = 'auto'): 'gregorian' | 'julian' {
  if (calendar !== 'auto') return calendar;
  if (civil.year !== GREGORIAN_REFORM.year) return civil.year < GREGORIAN_REFORM.year ? 'julian' : 'gregorian';
  if (civil.month !== GREGORIAN_REFORM.month) return civil.month < GREGORIAN_REFORM.month ? 'julian' : 'gregorian';
  return civil.day < GREGORIAN_REFORM.day ? 'julian' : 'gregorian';
}

export function resolveMoment(input: BirthMomentInput): ResolvedMoment {
  const { civil, coordinates } = input;
  const calendar = resolveCalendar(civil, input.calendar);
  const warnings: TimeWarning[] = [];
  const fingerprint = tzdbFingerprint();

  if (calendar === 'julian') {
    warnings.push({
      code: 'julian-calendar',
      message:
        'This date is read in the Julian calendar. If it was written in the Gregorian calendar — Russia and Greece kept the Julian one into the twentieth century — set the calendar explicitly.',
    });
  }

  // A stated offset wins outright. It is the only answer available for a wartime
  // zone or a birth certificate that records the offset and nothing else, and
  // second-guessing the user with a lookup is how we would get Vevay wrong again.
  if (input.offsetOverrideMinutes !== undefined) {
    return {
      civil,
      offsetMinutes: input.offsetOverrideMinutes,
      provenance: 'manual',
      zone: input.zoneOverride ?? null,
      calendar,
      alternativeOffsetMinutes: [],
      warnings,
      tzdbFingerprint: fingerprint,
    };
  }

  const zone = input.zoneOverride ?? lookupZone(coordinates);

  if (isFixedOffsetZone(zone)) {
    warnings.push({
      code: 'ocean-coordinates',
      message: `These coordinates are not in any country's timezone (${zone}), which usually means they are open water or mistyped. A fixed offset has been used; enter the offset yourself if the location is right.`,
    });
  }

  // Interpreting the wall time needs an instant to ask tzdb about, and the instant
  // needs the offset. Reading the wall time as if it were UTC is close enough to
  // pick the era — it can only be wrong by the offset itself, under a day.
  const approximateInstant = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, civil.second);

  if (useLocalMeanTime(zone, civil.year, approximateInstant)) {
    const offsetMinutes = localMeanTimeOffsetMinutes(coordinates.longitude);
    warnings.push({
      code: 'lmt-used',
      message: `Standard time zones did not exist yet in ${String(civil.year)}, so Local Mean Time from this longitude has been used (${formatOffset(offsetMinutes)}). Towns kept their own solar time, so this is the clock a birth record of that era would have meant.`,
    });
    return {
      civil,
      offsetMinutes,
      provenance: 'lmt',
      zone: null,
      calendar,
      alternativeOffsetMinutes: [],
      warnings,
      tzdbFingerprint: fingerprint,
    };
  }

  if (offsetDisagreesNearby(coordinates, civil)) {
    warnings.push({
      code: 'zone-boundary',
      message:
        'Nearby locations were on a different UTC offset at this moment, so these coordinates sit close to a timezone boundary. County boundaries defeat coordinate lookups — Indiana is the classic case. Check the offset below against the birth record, and correct it if it disagrees.',
    });
  }

  const candidates = offsetCandidates(zone, civil);

  if (candidates.length === 0) {
    // A spring-forward gap. Interpreting with the pre-transition offset shifts the
    // result forward out of the gap, which is what every mainstream date library
    // does; the point here is to say so rather than do it quietly.
    const dayMs = 86_400_000;
    const offsetMinutes = zoneOffsetMinutes(zone, approximateInstant - dayMs);
    warnings.push({
      code: 'nonexistent-local-time',
      message: `Clocks skipped this hour in ${zone} — the stated time never occurred there. It has been read using the offset in force just before the change (${formatOffset(offsetMinutes)}), which places the birth just after clocks moved forward. If the record was written in the new time, enter the offset yourself.`,
    });
    return {
      civil,
      offsetMinutes,
      provenance: 'tzdb',
      zone,
      calendar,
      alternativeOffsetMinutes: [],
      warnings,
      tzdbFingerprint: fingerprint,
    };
  }

  const [first, ...rest] = candidates;
  if (first === undefined) throw new Error('unreachable: candidates is non-empty');

  if (rest.length > 0) {
    warnings.push({
      code: 'ambiguous-local-time',
      message: `Clocks went back in ${zone}, so this wall-clock time happened twice. The first occurrence has been used (${formatOffset(first.offsetMinutes)}); the second was ${rest.map((c) => formatOffset(c.offsetMinutes)).join(' or ')}. Nothing in the date can decide between them — if the record says which, set the offset yourself.`,
    });
  }

  return {
    civil,
    offsetMinutes: first.offsetMinutes,
    provenance: 'tzdb',
    zone,
    calendar,
    alternativeOffsetMinutes: rest.map((c) => c.offsetMinutes),
    warnings,
    tzdbFingerprint: fingerprint,
  };
}

/** `+01:00`, `-04:56:02` — seconds shown only when an LMT offset needs them. */
export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const total = Math.abs(minutes) * 60;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.round(total % 60);
  const pad = (v: number): string => String(v).padStart(2, '0');
  return `${sign}${pad(h)}:${pad(m)}${s === 0 ? '' : `:${pad(s)}`}`;
}
