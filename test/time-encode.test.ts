/**
 * A birth moment must survive a round trip through a URL.
 *
 * The link is a sharing mechanism and, for a user who never signs in, sometimes the
 * only copy of the data. The case that matters most is the offset override: it is
 * the user correcting us, and a link that dropped it would hand the recipient a
 * different chart from the one that was shared, with nothing to indicate it.
 */
import { describe, expect, it } from 'vitest';
import { BirthMomentLinkError, decodeBirthMoment, encodeBirthMoment } from '../src/time/encode.js';
import { resolveMoment } from '../src/time/resolve.js';
import type { BirthMomentInput } from '../src/time/types.js';

const VEVAY: BirthMomentInput = {
  civil: { year: 1960, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
  coordinates: { latitude: 38.7478, longitude: -85.0672 },
};

function roundTrip(input: BirthMomentInput): BirthMomentInput {
  return decodeBirthMoment(new URLSearchParams(encodeBirthMoment(input).toString()));
}

describe('birth moment links', () => {
  it('round-trips a plain moment', () => {
    expect(roundTrip(VEVAY)).toEqual(VEVAY);
  });

  it('round-trips an offset override, including a negative one', () => {
    const corrected = { ...VEVAY, offsetOverrideMinutes: -300 };
    expect(roundTrip(corrected)).toEqual(corrected);
    // And the resolution is identical on both sides, which is the point.
    expect(resolveMoment(roundTrip(corrected)).offsetMinutes).toBe(-300);
    expect(resolveMoment(roundTrip(corrected)).provenance).toBe('manual');
  });

  it('round-trips a zero override, which is not the same as no override', () => {
    // 0 is a real offset (UTC). A truthiness check would drop it and fall back to
    // the lookup, which is a silent one-to-twelve-hour error.
    const utc = { ...VEVAY, offsetOverrideMinutes: 0 };
    expect(roundTrip(utc).offsetOverrideMinutes).toBe(0);
    expect(resolveMoment(roundTrip(utc)).provenance).toBe('manual');
    expect(resolveMoment(roundTrip(VEVAY)).provenance).toBe('tzdb');
  });

  it('round-trips a fractional LMT-style override', () => {
    const lmt = { ...VEVAY, offsetOverrideMinutes: -296.024 };
    expect(roundTrip(lmt).offsetOverrideMinutes).toBe(-296.024);
  });

  it('round-trips a zone override and a calendar', () => {
    const full: BirthMomentInput = {
      ...VEVAY,
      zoneOverride: 'America/Indiana/Vevay',
      calendar: 'julian',
    };
    expect(roundTrip(full)).toEqual(full);
  });

  it('omits absent options rather than encoding empty values', () => {
    const params = encodeBirthMoment(VEVAY);
    expect(params.has('off')).toBe(false);
    expect(params.has('tz')).toBe(false);
    // `auto` is the default, so it stays out of the common link.
    expect(encodeBirthMoment({ ...VEVAY, calendar: 'auto' }).has('cal')).toBe(false);
  });

  it('stays legible, so a user can read and correct it by hand', () => {
    expect(decodeURIComponent(encodeBirthMoment(VEVAY).toString())).toBe('d=1960-06-15&t=14:30&la=38.7478&lo=-85.0672');
  });

  it('keeps seconds when they are given and drops them when they are not', () => {
    expect(encodeBirthMoment(VEVAY).get('t')).toBe('14:30');
    const precise = { ...VEVAY, civil: { ...VEVAY.civil, second: 7 } };
    expect(encodeBirthMoment(precise).get('t')).toBe('14:30:07');
    expect(roundTrip(precise).civil.second).toBe(7);
  });

  it('round-trips midnight, which pads to 00:00 rather than vanishing', () => {
    const midnight = { ...VEVAY, civil: { ...VEVAY.civil, hour: 0, minute: 0 } };
    expect(encodeBirthMoment(midnight).get('t')).toBe('00:00');
    expect(roundTrip(midnight).civil).toEqual(midnight.civil);
  });

  it('round-trips a BCE year', () => {
    const ancient = { ...VEVAY, civil: { ...VEVAY.civil, year: -44 } };
    expect(encodeBirthMoment(ancient).get('d')).toBe('-0044-06-15');
    expect(roundTrip(ancient).civil.year).toBe(-44);
  });

  it('accepts a hand-written link with unpadded parts', () => {
    const decoded = decodeBirthMoment(new URLSearchParams('d=1960-6-5&t=9:05&la=38.7478&lo=-85.0672'));
    expect(decoded.civil).toEqual({ year: 1960, month: 6, day: 5, hour: 9, minute: 5, second: 0 });
  });
});

describe('bad links fail loudly', () => {
  const cases: [string, string][] = [
    ['t=14:30&la=1&lo=1', 'missing date'],
    ['d=1960-06-15&la=1&lo=1', 'missing time'],
    ['d=1960-06-15&t=14:30&lo=1', 'missing latitude'],
    ['d=1960-06-15&t=14:30&la=1', 'missing longitude'],
    ['d=nonsense&t=14:30&la=1&lo=1', 'unparseable date'],
    ['d=1960-06-15&t=half+two&la=1&lo=1', 'unparseable time'],
    ['d=1960-13-15&t=14:30&la=1&lo=1', 'month 13'],
    ['d=1960-06-32&t=14:30&la=1&lo=1', 'day 32'],
    ['d=1960-06-15&t=24:00&la=1&lo=1', 'hour 24'],
    ['d=1960-06-15&t=14:60&la=1&lo=1', 'minute 60'],
    ['d=1960-06-15&t=14:30&la=91&lo=1', 'latitude out of range'],
    ['d=1960-06-15&t=14:30&la=1&lo=181', 'longitude out of range'],
    ['d=1960-06-15&t=14:30&la=abc&lo=1', 'non-numeric latitude'],
    ['d=1960-06-15&t=14:30&la=1&lo=1&off=abc', 'non-numeric offset'],
    ['d=1960-06-15&t=14:30&la=1&lo=1&cal=mayan', 'unknown calendar'],
  ];

  it.each(cases)('rejects %s (%s)', (query) => {
    // Refusing a bad link is the whole requirement. Falling back to "today at
    // Greenwich" would render a confident, entirely fictional chart.
    expect(() => decodeBirthMoment(new URLSearchParams(query))).toThrow(BirthMomentLinkError);
  });

  it('explains what is wrong, by name', () => {
    expect(() => decodeBirthMoment(new URLSearchParams('d=1960-06-15&t=14:30&la=1'))).toThrow(/longitude/);
    expect(() => decodeBirthMoment(new URLSearchParams('d=1960-06-15&t=14:30&la=1&lo=1&cal=mayan'))).toThrow(
      /gregorian, julian, auto/,
    );
  });
});
