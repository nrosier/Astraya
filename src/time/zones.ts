/**
 * Timezone and Local Mean Time primitives.
 *
 * Everything here is pure and synchronous. The interesting parts are the two
 * places the naive answer is wrong:
 *
 * 1. **A coordinate lookup can be off by a whole hour.** `tz-lookup` resolves
 *    Vevay, Indiana to `America/New_York` rather than `America/Indiana/Vevay`.
 *    Those share today's rules but not 1960's, so a 1960 birth there comes out an
 *    hour wrong — about 15 degrees of Ascendant. Rather than special-casing
 *    Indiana, `offsetDisagreesNearby` samples a ring around the coordinate and
 *    reports when neighbours disagree *at the birth instant*. That catches
 *    Indiana, the Basel tri-border, and open water alike.
 *
 * 2. **tzdb's pre-standard-time offsets belong to the zone's reference city**,
 *    not to the birthplace, so longitude-derived LMT is better — but only where
 *    tzdb genuinely has no standard time. New Zealand adopted standard time in
 *    1868 and Liberia kept a legal -0:44:30 until 1972; overriding either with
 *    longitude would make them worse. See `useLocalMeanTime`.
 */
import tzlookup from 'tz-lookup';
import { IANAZone } from 'luxon';
import type { CivilDateTime, Coordinates } from './types.js';

/**
 * Standard time zones did not exist before roughly 1880: Britain legislated GMT
 * in 1880 and the US railroads adopted zones in 1883. Before then a town kept its
 * own solar time.
 */
export const STANDARD_TIME_FROM_YEAR = 1880;

/** IANA zone for a coordinate. Never throws — open water yields an `Etc/*` zone. */
export function lookupZone(coordinates: Coordinates): string {
  return tzlookup(clampLatitude(coordinates.latitude), wrapLongitude(coordinates.longitude));
}

/**
 * True for the fixed-offset zones a coordinate lookup falls back to over open
 * water. They carry no history, so a historical birth in one is a sign the
 * coordinates are wrong rather than a usable answer.
 *
 * Catches most of the open ocean but deliberately claims no more than that — the
 * lookup snaps to the nearest zone polygon rather than admitting defeat, and
 * measurement bears this out: mid-Atlantic (0, -30) gives `Etc/GMT+2`, but
 * mid-Pacific (0, -150) gives `Pacific/Kiritimati` because Kiribati's polygon
 * reaches that far, and coastal water gives the neighbouring country. That last
 * case is the right answer anyway. There is no cheap client-side fix for the
 * others, and no reason to pretend otherwise: a birthplace is on land, so an ocean
 * coordinate is a typo, and the offset override exists for when we are wrong.
 */
export function isFixedOffsetZone(zone: string): boolean {
  return zone.startsWith('Etc/') || zone === 'UTC' || zone === 'GMT';
}

/** Offset in minutes east of UTC that `zone` was on at `instant` (epoch ms). */
export function zoneOffsetMinutes(zone: string, instant: number): number {
  return IANAZone.create(zone).offset(instant);
}

/**
 * Local Mean Time offset for a longitude: the sun's own timekeeping, four minutes
 * per degree. Kept in fractional minutes rather than rounded, because rounding to
 * the minute is a quarter-degree of Ascendant thrown away for nothing.
 */
export function localMeanTimeOffsetMinutes(longitude: number): number {
  // Rounded to a millisecond of time (1/60000 min) purely to keep binary floating
  // point noise out of stored records and URLs: the raw division yields values like
  // -296.0239999999999, which is the same instant but a worse thing to persist.
  const minutes = (wrapLongitude(longitude) / 15) * 60;
  return Math.round(minutes * 60_000) / 60_000;
}

/**
 * Whether to prefer longitude-derived LMT over tzdb for this instant.
 *
 * Both conditions are needed. The year alone would override New Zealand's 1868
 * standard time with a worse number. The offset test alone would override
 * Liberia's legal -0:44:30, which stood until 1972.
 *
 * The offset test works because standard time offsets are whole minutes, while an
 * LMT offset almost never is — tzdb reports Amsterdam as +00:17:30 and New York
 * as -04:56:02 for the 1870s. A non-integral minute count is tzdb saying "this is
 * the reference city's solar time", which is exactly when the birthplace's own
 * longitude is the better source.
 */
export function useLocalMeanTime(zone: string, year: number, instant: number): boolean {
  if (year >= STANDARD_TIME_FROM_YEAR) return false;
  const offset = zoneOffsetMinutes(zone, instant);
  return !Number.isInteger(offset);
}

/** A candidate mapping of a local wall time onto the timeline. */
export interface OffsetCandidate {
  readonly offsetMinutes: number;
  readonly instant: number;
}

/**
 * Every offset under which `civil` is a real wall-clock time in `zone`.
 *
 * - one candidate is the ordinary case
 * - two means a DST fall-back overlap: the clock read this time twice
 * - none means a spring-forward gap: the clock never read this time
 *
 * Returning the set rather than picking silently is the point. A library that
 * quietly chooses for you turns an hour of genuine uncertainty into an
 * unremarkable-looking chart.
 */
export function offsetCandidates(zone: string, civil: CivilDateTime): readonly OffsetCandidate[] {
  const wallAsUtc = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, civil.second);
  // A transition is at most a day away from the wall time it affects, so the
  // offsets in force a day either side are the only candidates worth testing.
  const day = 86_400_000;
  const candidates = new Set([
    zoneOffsetMinutes(zone, wallAsUtc - day),
    zoneOffsetMinutes(zone, wallAsUtc),
    zoneOffsetMinutes(zone, wallAsUtc + day),
  ]);

  const valid: OffsetCandidate[] = [];
  for (const offsetMinutes of candidates) {
    const instant = wallAsUtc - offsetMinutes * 60_000;
    // Self-consistency: an offset only counts if the zone was actually on it at
    // the instant that offset implies.
    if (zoneOffsetMinutes(zone, instant) === offsetMinutes) valid.push({ offsetMinutes, instant });
  }
  return valid.sort((a, b) => a.instant - b.instant);
}

/**
 * Whether coordinates near this one resolve to a *different offset* at this
 * instant. Not merely a different zone name: `America/New_York` and
 * `America/Indiana/Indianapolis` agree today and disagree in 1960, and it is the
 * disagreement at the birth instant that changes the chart.
 */
export function offsetDisagreesNearby(coordinates: Coordinates, civil: CivilDateTime, radiusKm = 25): boolean {
  const wallAsUtc = Date.UTC(civil.year, civil.month - 1, civil.day, civil.hour, civil.minute, civil.second);
  const dLat = radiusKm / 111;
  // Guard the cosine near the poles, where a degree of longitude is metres.
  const dLon = radiusKm / (111 * Math.max(0.05, Math.cos((coordinates.latitude * Math.PI) / 180)));

  const offsets = new Set<number>();
  for (const [a, b] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const) {
    const zone = lookupZone({
      latitude: coordinates.latitude + a * dLat,
      longitude: coordinates.longitude + b * dLon,
    });
    offsets.add(zoneOffsetMinutes(zone, wallAsUtc));
    if (offsets.size > 1) return true;
  }
  return false;
}

/**
 * Identifies the timezone database that produced an offset.
 *
 * There is no API for the tzdb version, so this is a behavioural fingerprint:
 * offsets at instants that have changed between releases. It is not meant to be
 * decoded, only compared — if a stored chart's fingerprint no longer matches, the
 * historical data underneath it has moved and the offset is worth re-checking.
 */
export function tzdbFingerprint(): string {
  const probes: readonly [string, string][] = [
    ['Europe/Amsterdam', '1870-06-15T12:00:00Z'],
    ['America/Indiana/Vevay', '1960-06-15T12:00:00Z'],
    ['Europe/London', '1942-06-15T12:00:00Z'],
    ['Europe/Moscow', '1935-06-15T12:00:00Z'],
    ['Pacific/Auckland', '1870-06-15T12:00:00Z'],
  ];
  return probes.map(([zone, iso]) => zoneOffsetMinutes(zone, Date.parse(iso)).toFixed(4)).join('|');
}

function clampLatitude(latitude: number): number {
  return Math.max(-89.9999, Math.min(89.9999, latitude));
}

function wrapLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}
