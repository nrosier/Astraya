import { describe, expect, it } from 'vitest';
import { HORARY_HOUSE_SYSTEMS, nowFields, parseHoraryFields } from '../src/ui/horary.js';
import { horaryViewMessages } from '../src/ui/HoraryView.messages.js';
import { parseRoute } from '../src/ui/route.js';

const GOOD = { date: '2024-03-08', time: '14:30', latitude: '51.5072', longitude: '-0.1276' };

describe('parseHoraryFields (#406)', () => {
  it('turns good fields into a local civil moment with coordinates and no zone (it is found from the place)', () => {
    const parsed = parseHoraryFields(GOOD);
    expect(parsed).toEqual({
      ok: true,
      moment: {
        civil: { year: 2024, month: 3, day: 8, hour: 14, minute: 30, second: 0 },
        coordinates: { latitude: 51.5072, longitude: -0.1276 },
      },
    });
  });

  it('accepts a comma as the decimal separator, as a Dutch keyboard types it', () => {
    const parsed = parseHoraryFields({ ...GOOD, latitude: '51,5072', longitude: '-0,1276' });
    expect(parsed.ok && parsed.moment.coordinates).toEqual({ latitude: 51.5072, longitude: -0.1276 });
  });

  it('accepts seconds in the time when the browser supplies them', () => {
    const parsed = parseHoraryFields({ ...GOOD, time: '14:30:45' });
    expect(parsed.ok && parsed.moment.civil.second).toBe(45);
  });

  it('rejects a date that does not exist, rather than rolling it into the next month', () => {
    for (const date of [
      '2024-02-30',
      '2023-02-29',
      '2024-13-01',
      '2024-00-10',
      '2024-04-31',
      '',
      'yesterday',
      '8-3-2024',
    ]) {
      expect(parseHoraryFields({ ...GOOD, date })).toEqual({ ok: false, field: 'date' });
    }
  });

  it('accepts 29 February in a leap year', () => {
    expect(parseHoraryFields({ ...GOOD, date: '2024-02-29' }).ok).toBe(true);
  });

  it('rejects a time out of range or malformed', () => {
    for (const time of ['24:00', '12:60', '', '2pm', '12', '12:5']) {
      expect(parseHoraryFields({ ...GOOD, time })).toEqual({ ok: false, field: 'time' });
    }
    expect(parseHoraryFields({ ...GOOD, time: '00:00' }).ok).toBe(true);
    expect(parseHoraryFields({ ...GOOD, time: '23:59' }).ok).toBe(true);
  });

  it('rejects a latitude or longitude that is out of range, empty or not a plain number', () => {
    for (const latitude of ['', '91', '-90.01', 'north', '51.5N', '1e1']) {
      expect(parseHoraryFields({ ...GOOD, latitude })).toEqual({ ok: false, field: 'latitude' });
    }
    for (const longitude of ['', '180.5', '-181', 'west', '0.1W']) {
      expect(parseHoraryFields({ ...GOOD, longitude })).toEqual({ ok: false, field: 'longitude' });
    }
  });

  it('accepts the extremes of latitude and longitude', () => {
    expect(parseHoraryFields({ ...GOOD, latitude: '90', longitude: '180' }).ok).toBe(true);
    expect(parseHoraryFields({ ...GOOD, latitude: '-90', longitude: '-180' }).ok).toBe(true);
  });

  it('reports the first bad field, in the order the form lists them', () => {
    expect(parseHoraryFields({ date: 'x', time: 'x', latitude: 'x', longitude: 'x' })).toEqual({
      ok: false,
      field: 'date',
    });
    expect(parseHoraryFields({ ...GOOD, latitude: 'x', longitude: 'x' })).toEqual({ ok: false, field: 'latitude' });
  });
});

describe('nowFields', () => {
  it('formats the browser’s local date and time the way the date and time inputs expect', () => {
    expect(nowFields(new Date(2024, 2, 8, 9, 5))).toEqual({ date: '2024-03-08', time: '09:05' });
    expect(nowFields(new Date(2025, 11, 31, 23, 59))).toEqual({ date: '2025-12-31', time: '23:59' });
  });
});

describe('horary screen wiring', () => {
  it('routes #/horary to the screen', () => {
    expect(parseRoute('#/horary')).toEqual({ kind: 'horary' });
    expect(parseRoute('#/horary/')).toEqual({ kind: 'horary' });
  });

  it('offers Regiomontanus first, the horary tradition’s own system, with a label for each in both languages', () => {
    expect(HORARY_HOUSE_SYSTEMS[0]).toBe('R');
    for (const messages of [horaryViewMessages.en, horaryViewMessages.nl]) {
      for (const code of HORARY_HOUSE_SYSTEMS) expect(messages.houseSystems[code]).toBeTruthy();
    }
  });

  it('describes every consideration in both languages', () => {
    const keys = [
      'ascendant-too-early',
      'ascendant-too-late',
      'moon-void-of-course',
      'moon-via-combusta',
      'saturn-in-seventh',
    ];
    for (const messages of [horaryViewMessages.en, horaryViewMessages.nl]) {
      for (const key of keys) {
        expect(messages.considerations[key]?.label).toBeTruthy();
        expect(messages.considerations[key]?.explanation).toBeTruthy();
      }
    }
  });

  it('pluralises the count of considerations that apply', () => {
    expect(horaryViewMessages.en.notRadical(1)).toContain('1 consideration applies');
    expect(horaryViewMessages.en.notRadical(3)).toContain('3 considerations apply');
    expect(horaryViewMessages.nl.notRadical(1)).toContain('1 overweging is van toepassing');
    expect(horaryViewMessages.nl.notRadical(2)).toContain('2 overwegingen zijn van toepassing');
  });
});
