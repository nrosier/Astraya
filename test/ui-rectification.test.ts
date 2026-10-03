import { describe, expect, it } from 'vitest';
import { MAX_RECTIFICATION_CANDIDATES } from '../src/astrology/rectification.js';
import { candidateMinutes } from '../src/domain/rectification.js';
import {
  eventNoonParts,
  parseRectificationFields,
  RECTIFICATION_STEP_MINUTES,
  type RectificationFields,
} from '../src/ui/rectification.js';
import { rectificationViewMessages } from '../src/ui/RectificationView.messages.js';
import { parseRoute } from '../src/ui/route.js';

const GOOD: RectificationFields = {
  birthDate: '1985-03-12',
  fromTime: '06:00',
  toTime: '10:00',
  stepMinutes: 5,
  latitude: '51.5072',
  longitude: '-0.1276',
  events: [
    { date: '1999-08-11', label: 'moved abroad' },
    { date: '2004-11-06', label: '' },
  ],
};

describe('candidateMinutes (#408)', () => {
  it('lists the minutes from the earliest to the latest inclusive, step apart', () => {
    expect(candidateMinutes(0, 20, 5)).toEqual([0, 5, 10, 15, 20]);
    expect(candidateMinutes(60, 60, 5)).toEqual([60]);
  });

  it('stops short of a latest time the step does not land on', () => {
    expect(candidateMinutes(0, 12, 5)).toEqual([0, 5, 10]);
  });

  it('refuses a step below one minute, which would never advance', () => {
    expect(() => candidateMinutes(0, 10, 0)).toThrow(RangeError);
  });

  it('yields a whole day at five-minute steps within the limit', () => {
    expect(candidateMinutes(0, 1439, 5)).toHaveLength(288);
    expect(288).toBeLessThan(MAX_RECTIFICATION_CANDIDATES);
  });
});

describe('parseRectificationFields (#408)', () => {
  it('reads good fields into a request at local midnight of the birth date, with the candidate range in minutes', () => {
    const parsed = parseRectificationFields(GOOD);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.request.base.civil).toEqual({ year: 1985, month: 3, day: 12, hour: 0, minute: 0, second: 0 });
    expect(parsed.request.base.coordinates).toEqual({ latitude: 51.5072, longitude: -0.1276 });
    expect(parsed.request.fromMinute).toBe(360);
    expect(parsed.request.toMinute).toBe(600);
    expect(parsed.request.stepMinutes).toBe(5);
    expect(parsed.events).toHaveLength(2);
  });

  it('carries a person’s zone and offset overrides through, and omits them otherwise', () => {
    const withZone = parseRectificationFields({ ...GOOD, zoneOverride: 'Europe/London', offsetOverrideMinutes: 60 });
    expect(withZone.ok && withZone.request.base.zoneOverride).toBe('Europe/London');
    expect(withZone.ok && withZone.request.base.offsetOverrideMinutes).toBe(60);
    const bare = parseRectificationFields(GOOD);
    expect(bare.ok && 'zoneOverride' in bare.request.base).toBe(false);
  });

  it('drops blank event rows and keeps the others in order', () => {
    const parsed = parseRectificationFields({
      ...GOOD,
      events: [
        { date: '', label: 'ignored' },
        { date: '2000-01-01', label: 'a' },
        { date: '  ', label: '' },
        { date: '2001-02-03', label: 'b' },
      ],
    });
    expect(parsed.ok && parsed.events.map((event) => event.label)).toEqual(['a', 'b']);
  });

  it('reports the first bad field in the order the form lists them', () => {
    expect(parseRectificationFields({ ...GOOD, birthDate: '1985-02-30' })).toEqual({
      ok: false,
      error: { field: 'birthDate' },
    });
    expect(parseRectificationFields({ ...GOOD, fromTime: '25:00' })).toEqual({
      ok: false,
      error: { field: 'fromTime' },
    });
    expect(parseRectificationFields({ ...GOOD, toTime: '10:60' })).toEqual({ ok: false, error: { field: 'toTime' } });
    expect(parseRectificationFields({ ...GOOD, fromTime: '10:00', toTime: '09:59' })).toEqual({
      ok: false,
      error: { field: 'order' },
    });
    expect(parseRectificationFields({ ...GOOD, latitude: '95' })).toEqual({ ok: false, error: { field: 'latitude' } });
    expect(parseRectificationFields({ ...GOOD, longitude: 'west' })).toEqual({
      ok: false,
      error: { field: 'longitude' },
    });
  });

  it('accepts a single candidate time (earliest equals latest)', () => {
    expect(parseRectificationFields({ ...GOOD, fromTime: '08:20', toTime: '08:20' }).ok).toBe(true);
  });

  it('needs at least one event with a date', () => {
    expect(parseRectificationFields({ ...GOOD, events: [] })).toEqual({ ok: false, error: { field: 'events' } });
    expect(parseRectificationFields({ ...GOOD, events: [{ date: '', label: 'x' }] })).toEqual({
      ok: false,
      error: { field: 'events' },
    });
  });

  it('points at the event with the bad date, counting from zero', () => {
    const parsed = parseRectificationFields({
      ...GOOD,
      events: [
        { date: '2000-01-01', label: '' },
        { date: '2000-02-30', label: '' },
      ],
    });
    expect(parsed).toEqual({ ok: false, error: { field: 'eventDate', index: 1 } });
  });

  it('rejects an event on or before the birth date, since there is no age to direct by', () => {
    expect(parseRectificationFields({ ...GOOD, events: [{ date: '1985-03-12', label: '' }] })).toEqual({
      ok: false,
      error: { field: 'eventBeforeBirth', index: 0 },
    });
    expect(parseRectificationFields({ ...GOOD, events: [{ date: '1985-03-13', label: '' }] }).ok).toBe(true);
    expect(
      parseRectificationFields({
        ...GOOD,
        events: [
          { date: '2000-01-01', label: '' },
          { date: '1970-01-01', label: '' },
        ],
      }),
    ).toEqual({ ok: false, error: { field: 'eventBeforeBirth', index: 1 } });
  });
});

describe('rectification screen wiring', () => {
  it('routes #/rectification to the screen', () => {
    expect(parseRoute('#/rectification')).toEqual({ kind: 'rectification' });
    expect(parseRoute('#/rectification/')).toEqual({ kind: 'rectification' });
  });

  it('turns an event date into its parts, and rejects a date that does not exist', () => {
    expect(eventNoonParts('2004-11-06')).toEqual({ year: 2004, month: 11, day: 6 });
    expect(eventNoonParts('2004-02-30')).toBeUndefined();
    expect(eventNoonParts('')).toBeUndefined();
  });

  it('offers steps from one to fifteen minutes, labelled in both languages', () => {
    expect(RECTIFICATION_STEP_MINUTES[0]).toBe(1);
    for (const messages of [rectificationViewMessages.en, rectificationViewMessages.nl]) {
      for (const minutes of RECTIFICATION_STEP_MINUTES) expect(messages.stepOption(minutes)).toContain(String(minutes));
    }
  });

  it('numbers events from one in every field message, and states the caveat in both languages', () => {
    for (const messages of [rectificationViewMessages.en, rectificationViewMessages.nl]) {
      expect(messages.fieldErrors.eventDate(3)).toContain('3');
      expect(messages.fieldErrors.eventBeforeBirth(2)).toContain('2');
      expect(messages.removeEvent(4)).toContain('4');
      expect(messages.caveat.length).toBeGreaterThan(80);
    }
    expect(rectificationViewMessages.en.caveat).toMatch(/does not prove/);
  });
});
