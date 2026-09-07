/**
 * From a resolved birth moment to a Julian day (UT) — the ephemeris's only input.
 *
 * Two paths, chosen by date, because the accurate one does not exist for most of
 * history:
 *
 * - **1972 onward** the local time is converted to UTC civil fields and handed to
 *   `swe_utc_to_jd`, which knows about leap seconds. UT1 differs from UTC by up to
 *   0.9 s, which is about 13 arcseconds of Ascendant — inside our 1 arcminute cusp
 *   tolerance, but free to get right, so we get it right.
 * - **Before that**, and for any Julian-calendar date, the offset is applied in
 *   Julian-day space: `swe_julday` at midnight plus the elapsed fraction of a day.
 *   UTC did not exist, so there are no leap seconds to be aware of, and staying in
 *   JD space means no date arithmetic of ours has to know that an offset can push a
 *   birth across midnight, a month end, a year end, or the Gregorian reform gap.
 */
import { DateTime, FixedOffsetZone } from 'luxon';
import type { CalendarSystem, EphemerisProvider, JulianDayUT } from '../ephemeris/types.js';
import type { ResolvedMoment } from './types.js';

/**
 * First year for which `swe_utc_to_jd` has anything to add.
 *
 * UTC with leap seconds began in 1972. Swiss Ephemeris treats earlier UTC input as
 * UT anyway, so the two paths agree before this — but only one of them is honest
 * about it.
 */
const UTC_EXISTS_FROM_YEAR = 1972;

/** Decimal hours since local midnight. */
function decimalHour(moment: ResolvedMoment): number {
  const { hour, minute, second } = moment.civil;
  return hour + minute / 60 + second / 3600;
}

export async function julianDayFor(provider: EphemerisProvider, moment: ResolvedMoment): Promise<JulianDayUT> {
  const { civil, calendar, offsetMinutes } = moment;

  if (calendar === 'gregorian' && civil.year >= UTC_EXISTS_FROM_YEAR) {
    // Luxon does the civil arithmetic: a fixed-offset zone has no transitions, so
    // this is pure field conversion with no tzdb involvement and nothing to be
    // ambiguous about — the ambiguity was already settled during resolution.
    const utc = DateTime.fromObject(
      {
        year: civil.year,
        month: civil.month,
        day: civil.day,
        hour: civil.hour,
        minute: civil.minute,
        second: civil.second,
      },
      { zone: FixedOffsetZone.instance(offsetMinutes) },
    ).toUTC();
    if (!utc.isValid) {
      throw new Error(
        `Cannot convert ${JSON.stringify(civil)} at ${String(offsetMinutes)} min to UTC: ${utc.invalidReason}`,
      );
    }
    return provider.julianDayFromUtc(utc.year, utc.month, utc.day, utc.hour, utc.minute, utc.second);
  }

  // Midnight in the stated calendar, then add the elapsed day fraction. Adding in
  // JD space rather than to the civil fields is what makes an offset that crosses
  // midnight, or a date beside the 1582 reform gap, a non-event.
  const midnight = await provider.julianDay(civil.year, civil.month, civil.day, 0, calendar satisfies CalendarSystem);
  return midnight + (decimalHour(moment) - offsetMinutes / 60) / 24;
}
