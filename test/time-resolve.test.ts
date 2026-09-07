/**
 * Timezone regression suite — the cases that break naive implementations.
 *
 * A one-hour error moves the Ascendant about 15 degrees: a different rising sign,
 * a different chart, and nothing on screen to suggest anything is wrong. That makes
 * this the highest-leverage correctness work in the project, and it is why these
 * tests exist before the UI that will consume the resolver.
 *
 * Two kinds of assertion here, kept deliberately distinct:
 *
 *  - **Behaviour** — a transition was detected, ambiguity was surfaced, LMT was
 *    applied, an override won. These are properties of our code and must hold
 *    under any tzdb.
 *  - **Snapshots** — a specific historical offset. These are properties of the
 *    *data*, which changes: this project has measured Node's bundled ICU tzdb and
 *    the host's system tzdb disagreeing about the same historical instant. Every
 *    such value below was measured from the installed tzdb, never written from
 *    memory — an earlier attempt to recall Amsterdam's pre-war offset from memory
 *    was simply wrong. A failure here is therefore a *review prompt*, not
 *    necessarily a bug: check whether tzdb changed its mind, and if it did, update
 *    the value and note it in the changelog, because stored charts may shift.
 */
import { describe, expect, it } from 'vitest';
import { formatOffset, resolveCalendar, resolveMoment } from '../src/time/resolve.js';
import { localMeanTimeOffsetMinutes, offsetCandidates, STANDARD_TIME_FROM_YEAR } from '../src/time/zones.js';
import type { Coordinates, TimeWarningCode } from '../src/time/types.js';

const AT = {
  london: { latitude: 51.5074, longitude: -0.1278 },
  vevayIndiana: { latitude: 38.7478, longitude: -85.0672 },
  indianapolis: { latitude: 39.7684, longitude: -86.1581 },
  detroit: { latitude: 42.3314, longitude: -83.0458 },
  amsterdam: { latitude: 52.3676, longitude: 4.9041 },
  moscow: { latitude: 55.7558, longitude: 37.6173 },
  sydney: { latitude: -33.8688, longitude: 151.2093 },
  newYork: { latitude: 40.7128, longitude: -74.006 },
  dublin: { latitude: 53.3498, longitude: -6.2603 },
  kathmandu: { latitude: 27.7172, longitude: 85.324 },
  lordHowe: { latitude: -31.5553, longitude: 159.0821 },
  midAtlantic: { latitude: 0, longitude: -30 },
  rome: { latitude: 41.9028, longitude: 12.4964 },
  // `satisfies` rather than a type annotation: an annotated Record gives every
  // lookup a `| undefined` under noUncheckedIndexedAccess, for keys written right
  // here in the file.
} satisfies Record<string, Coordinates>;

function at(coordinates: Coordinates, y: number, mo: number, d: number, h: number, mi = 0) {
  return resolveMoment({ civil: { year: y, month: mo, day: d, hour: h, minute: mi, second: 0 }, coordinates });
}

function codes(moment: { warnings: readonly { code: TimeWarningCode }[] }): TimeWarningCode[] {
  return moment.warnings.map((w) => w.code);
}

describe('historical offsets (snapshots — see file header before "fixing" a failure)', () => {
  it('applies UK Double Summer Time in 1941 and plain BST the following winter', () => {
    // Britain ran BST through the 1940-45 winters and double summer time in summer,
    // so a naive "GMT in Britain" assumption is two hours out at midsummer.
    expect(at(AT.london, 1941, 6, 15, 12).offsetMinutes).toBe(120);
    expect(at(AT.london, 1942, 1, 15, 12).offsetMinutes).toBe(60);
  });

  it('places Amsterdam on CET in 1935 and German summer time in 1943', () => {
    expect(at(AT.amsterdam, 1935, 6, 15, 12).offsetMinutes).toBe(60);
    expect(at(AT.amsterdam, 1943, 6, 15, 12).offsetMinutes).toBe(120);
  });

  it('applies Soviet decree time: Moscow +3 standard becomes +4 in summer 1988', () => {
    expect(at(AT.moscow, 1930, 6, 15, 12).offsetMinutes).toBe(120);
    expect(at(AT.moscow, 1988, 6, 15, 12).offsetMinutes).toBe(240);
  });

  it('gets southern-hemisphere DST the right way round', () => {
    // January is summer in Sydney. Getting this backwards is a one-hour error in
    // exactly the hemisphere where a northern-centric assumption never gets tested.
    expect(at(AT.sydney, 1972, 1, 15, 12).offsetMinutes).toBe(660);
    expect(at(AT.sydney, 1972, 7, 15, 12).offsetMinutes).toBe(600);
  });

  it('handles offsets that are not whole hours', () => {
    expect(at(AT.kathmandu, 2000, 6, 15, 12).offsetMinutes).toBe(345);
    // Lord Howe's DST shift is 30 minutes, not 60.
    expect(at(AT.lordHowe, 2023, 1, 15, 12).offsetMinutes).toBe(660);
  });

  it('uses Dublin Mean Time for 1900 rather than GMT', () => {
    expect(at(AT.dublin, 1900, 6, 15, 12).offsetMinutes).toBeCloseTo(-25.35, 2);
  });
});

describe('the US 1918-1966 patchwork', () => {
  it('reads Detroit as EST in 1955 but EDT in 1968', () => {
    // Michigan opted out of DST for much of this period; Uniform Time made it
    // consistent from 1967. "The US observed DST" is false for these years.
    expect(at(AT.detroit, 1955, 6, 15, 12).offsetMinutes).toBe(-300);
    expect(at(AT.detroit, 1968, 6, 15, 12).offsetMinutes).toBe(-240);
  });

  it('flags Detroit 1955 as a zone boundary, because its neighbours disagreed', () => {
    expect(codes(at(AT.detroit, 1955, 6, 15, 12))).toContain('zone-boundary');
    // ...and does not cry wolf once the country agreed with itself again.
    expect(codes(at(AT.detroit, 1968, 6, 15, 12))).not.toContain('zone-boundary');
  });
});

describe('Indiana county-level divergence', () => {
  it('warns that Vevay is near a boundary, where the lookup picks the wrong county', () => {
    // Measured: tz-lookup returns America/New_York for Vevay rather than
    // America/Indiana/Vevay, giving -04:00 where Indiana was on -05:00 in 1960.
    // We cannot fix the polygon, so the requirement is that we never present the
    // result as certain. This warning is the whole reason the override field exists.
    const vevay = at(AT.vevayIndiana, 1960, 6, 15, 14, 30);
    expect(codes(vevay)).toContain('zone-boundary');
  });

  it('does not warn for Indianapolis, which the lookup gets right', () => {
    // The check has to be quiet on the ordinary case, or it means nothing.
    const indy = at(AT.indianapolis, 1960, 6, 15, 14, 30);
    expect(indy.zone).toBe('America/Indiana/Indianapolis');
    expect(indy.offsetMinutes).toBe(-300);
    expect(codes(indy)).not.toContain('zone-boundary');
  });

  it('lets a stated offset overrule the lookup entirely', () => {
    const corrected = resolveMoment({
      civil: { year: 1960, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
      coordinates: AT.vevayIndiana,
      offsetOverrideMinutes: -300,
    });
    expect(corrected.offsetMinutes).toBe(-300);
    expect(corrected.provenance).toBe('manual');
  });
});

describe('DST transition edge cases', () => {
  it('surfaces an ambiguous local time and keeps the alternative', () => {
    // 2023-11-05 01:30 happened twice in New York. Nothing in the birth data can
    // decide which; only the user can, so both must reach them.
    const moment = at(AT.newYork, 2023, 11, 5, 1, 30);
    expect(codes(moment)).toContain('ambiguous-local-time');
    expect(moment.offsetMinutes).toBe(-240);
    expect(moment.alternativeOffsetMinutes).toEqual([-300]);
    expect(
      offsetCandidates('America/New_York', { year: 2023, month: 11, day: 5, hour: 1, minute: 30, second: 0 }),
    ).toHaveLength(2);
  });

  it('surfaces a nonexistent local time rather than inventing an instant', () => {
    // 2023-03-12 02:30 never occurred in New York.
    const moment = at(AT.newYork, 2023, 3, 12, 2, 30);
    expect(codes(moment)).toContain('nonexistent-local-time');
    expect(moment.offsetMinutes).toBe(-300);
    expect(
      offsetCandidates('America/New_York', { year: 2023, month: 3, day: 12, hour: 2, minute: 30, second: 0 }),
    ).toHaveLength(0);
  });

  it('says nothing about an ordinary time an hour either side', () => {
    expect(codes(at(AT.newYork, 2023, 11, 5, 3, 30))).toEqual([]);
    expect(codes(at(AT.newYork, 2023, 3, 12, 4, 30))).toEqual([]);
  });
});

describe('pre-1880 Local Mean Time', () => {
  it('uses longitude rather than tzdb for an 1870 New York birth', () => {
    const moment = at(AT.newYork, 1870, 6, 15, 12);
    expect(moment.provenance).toBe('lmt');
    expect(codes(moment)).toContain('lmt-used');
    // Four minutes per degree of longitude, and no zone to name.
    expect(moment.offsetMinutes).toBeCloseTo((-74.006 / 15) * 60, 6);
    expect(moment.zone).toBeNull();
  });

  it('derives LMT from the birthplace, not the zone reference city', () => {
    // tzdb gives one LMT for the whole of a zone, taken from its reference city.
    // A birth 100km east of it happened four minutes earlier by the sun, and that
    // is a degree of Ascendant we have no reason to discard.
    const west = localMeanTimeOffsetMinutes(4.9041);
    const east = localMeanTimeOffsetMinutes(6.9041);
    expect(east - west).toBeCloseTo(8, 6);
  });

  it('keeps tzdb once standard time exists', () => {
    expect(at(AT.newYork, 1900, 6, 15, 12).provenance).toBe('tzdb');
    expect(STANDARD_TIME_FROM_YEAR).toBe(1880);
  });

  it('rounds the offset cleanly enough to persist', () => {
    // The raw division produces values like -296.0239999999999. Same instant,
    // worse thing to store in a record or a shareable URL.
    expect(String(localMeanTimeOffsetMinutes(-74.006))).toBe('-296.024');
  });
});

describe('coordinates with no real zone', () => {
  it('flags an open-ocean coordinate as suspect', () => {
    const moment = at(AT.midAtlantic, 1990, 6, 15, 12);
    expect(codes(moment)).toContain('ocean-coordinates');
  });
});

describe('the Julian calendar', () => {
  it('reads dates before 15 October 1582 as Julian, and after as Gregorian', () => {
    const civil = (y: number, mo: number, d: number) => ({
      year: y,
      month: mo,
      day: d,
      hour: 12,
      minute: 0,
      second: 0,
    });
    expect(resolveCalendar(civil(1582, 10, 4))).toBe('julian');
    expect(resolveCalendar(civil(1582, 10, 15))).toBe('gregorian');
    expect(resolveCalendar(civil(1582, 9, 30))).toBe('julian');
    expect(resolveCalendar(civil(1583, 1, 1))).toBe('gregorian');
    expect(resolveCalendar(civil(1500, 6, 15))).toBe('julian');
  });

  it('stays overridable, because Russia and Greece kept the Julian calendar', () => {
    // A date written in Moscow in 1900 may be either calendar, thirteen days apart.
    // Defaulting to Gregorian is right; refusing to be corrected would not be.
    const civil = { year: 1900, month: 6, day: 15, hour: 12, minute: 0, second: 0 };
    expect(resolveCalendar(civil)).toBe('gregorian');
    expect(resolveCalendar(civil, 'julian')).toBe('julian');
    const moment = resolveMoment({ civil, coordinates: AT.moscow, calendar: 'julian' });
    expect(moment.calendar).toBe('julian');
    expect(codes(moment)).toContain('julian-calendar');
  });

  it('combines a Julian date with LMT for a 1500 Rome birth', () => {
    const moment = at(AT.rome, 1500, 6, 15, 12);
    expect(moment.calendar).toBe('julian');
    expect(moment.provenance).toBe('lmt');
    expect(codes(moment)).toEqual(expect.arrayContaining(['julian-calendar', 'lmt-used']));
  });
});

describe('provenance is always reported', () => {
  it('names how every offset was arrived at', () => {
    expect(at(AT.london, 1990, 6, 15, 12).provenance).toBe('tzdb');
    expect(at(AT.newYork, 1870, 6, 15, 12).provenance).toBe('lmt');
    expect(
      resolveMoment({
        civil: { year: 1990, month: 6, day: 15, hour: 12, minute: 0, second: 0 },
        coordinates: AT.london,
        offsetOverrideMinutes: 90,
      }).provenance,
    ).toBe('manual');
  });

  it('records which tzdb produced the offset, so a stored chart cannot drift silently', () => {
    const moment = at(AT.london, 1990, 6, 15, 12);
    expect(moment.tzdbFingerprint).toMatch(/\S/);
    // Same input, same fingerprint — it identifies the data, not the call.
    expect(at(AT.london, 1990, 6, 15, 12).tzdbFingerprint).toBe(moment.tzdbFingerprint);
  });

  it('carries the civil time it resolved, so the pair cannot be mismatched', () => {
    expect(at(AT.london, 1990, 6, 15, 12, 34).civil).toEqual({
      year: 1990,
      month: 6,
      day: 15,
      hour: 12,
      minute: 34,
      second: 0,
    });
  });
});

describe('formatOffset', () => {
  it('shows seconds only when an LMT offset needs them', () => {
    expect(formatOffset(0)).toBe('+00:00');
    expect(formatOffset(60)).toBe('+01:00');
    expect(formatOffset(-300)).toBe('-05:00');
    expect(formatOffset(345)).toBe('+05:45');
    expect(formatOffset(-296.024)).toBe('-04:56:01');
  });
});
