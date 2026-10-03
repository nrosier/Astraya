import { describe, expect, it } from 'vitest';
import { ELECTION_RULE_KEYS, type ElectionRuleKey, type ElectionWindow } from '../src/astrology/electional.js';
import {
  ELECTION_STEP_MINUTES,
  electionRows,
  formatDuration,
  formatUtcMinute,
  MAX_ELECTION_SPAN_DAYS,
  parseElectionFields,
  type ElectionFields,
} from '../src/ui/electional.js';
import { electionalViewMessages } from '../src/ui/ElectionalView.messages.js';
import { parseLatitude, parseLongitude } from '../src/ui/place-fields.js';
import { parseRoute } from '../src/ui/route.js';

const RULES: ReadonlySet<ElectionRuleKey> = new Set(['moon-not-void', 'mercury-direct']);
const GOOD: ElectionFields = {
  fromDate: '2024-03-08',
  toDate: '2024-03-10',
  latitude: '51.5072',
  longitude: '-0.1276',
  rules: RULES,
};

describe('parseElectionFields (#409)', () => {
  it('reads good fields into a search covering the whole of the last day', () => {
    const parsed = parseElectionFields(GOOD);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.search.from).toEqual({ year: 2024, month: 3, day: 8 });
    // Searched up to the day after the last, so 10 March is covered to midnight.
    expect(parsed.search.to).toEqual({ year: 2024, month: 3, day: 11 });
    expect(parsed.search.place).toEqual({ latitude: 51.5072, longitude: -0.1276, altitude: 0 });
    expect(parsed.search.rules).toBe(RULES);
  });

  it('carries the end across a month and a year boundary, and over a leap day', () => {
    const at = (toDate: string) => {
      const parsed = parseElectionFields({ ...GOOD, fromDate: toDate, toDate });
      return parsed.ok ? parsed.search.to : undefined;
    };
    expect(at('2024-03-31')).toEqual({ year: 2024, month: 4, day: 1 });
    expect(at('2024-12-31')).toEqual({ year: 2025, month: 1, day: 1 });
    expect(at('2024-02-28')).toEqual({ year: 2024, month: 2, day: 29 });
    expect(at('2023-02-28')).toEqual({ year: 2023, month: 3, day: 1 });
  });

  it('rejects an impossible or malformed date, naming which one', () => {
    expect(parseElectionFields({ ...GOOD, fromDate: '2024-02-30' })).toEqual({ ok: false, error: 'fromDate' });
    expect(parseElectionFields({ ...GOOD, fromDate: '' })).toEqual({ ok: false, error: 'fromDate' });
    expect(parseElectionFields({ ...GOOD, toDate: '2023-02-29' })).toEqual({ ok: false, error: 'toDate' });
    expect(parseElectionFields({ ...GOOD, toDate: 'tomorrow' })).toEqual({ ok: false, error: 'toDate' });
  });

  it('rejects an end before the start, but accepts a single day', () => {
    expect(parseElectionFields({ ...GOOD, fromDate: '2024-03-10', toDate: '2024-03-09' })).toEqual({
      ok: false,
      error: 'order',
    });
    expect(parseElectionFields({ ...GOOD, fromDate: '2024-03-10', toDate: '2024-03-10' }).ok).toBe(true);
  });

  it('allows exactly the longest span and refuses one day more', () => {
    expect(parseElectionFields({ ...GOOD, fromDate: '2024-03-01', toDate: '2024-03-31' }).ok).toBe(true);
    expect(MAX_ELECTION_SPAN_DAYS).toBe(31);
    expect(parseElectionFields({ ...GOOD, fromDate: '2024-03-01', toDate: '2024-04-01' })).toEqual({
      ok: false,
      error: 'span',
    });
  });

  it('rejects bad coordinates and an empty rule set', () => {
    expect(parseElectionFields({ ...GOOD, latitude: '95' })).toEqual({ ok: false, error: 'latitude' });
    expect(parseElectionFields({ ...GOOD, longitude: 'west' })).toEqual({ ok: false, error: 'longitude' });
    expect(parseElectionFields({ ...GOOD, rules: new Set() })).toEqual({ ok: false, error: 'rules' });
  });

  it('reports the first problem in the order the form lists its fields', () => {
    expect(
      parseElectionFields({ fromDate: 'x', toDate: 'x', latitude: 'x', longitude: 'x', rules: new Set() }),
    ).toEqual({ ok: false, error: 'fromDate' });
    expect(parseElectionFields({ ...GOOD, latitude: 'x', rules: new Set() })).toEqual({ ok: false, error: 'latitude' });
  });
});

describe('place fields (shared coordinate parsing)', () => {
  it('accepts a decimal comma, and the extremes of each range', () => {
    expect(parseLatitude('51,5')).toBe(51.5);
    expect(parseLongitude('-0,25')).toBe(-0.25);
    expect(parseLatitude('90')).toBe(90);
    expect(parseLatitude('-90')).toBe(-90);
    expect(parseLongitude('180')).toBe(180);
    expect(parseLongitude('-180')).toBe(-180);
  });

  it('rejects out of range, empty and non-numeric values', () => {
    for (const bad of ['', '90.01', '-91', 'north', '51.5N', '1e1', ' ']) expect(parseLatitude(bad)).toBeUndefined();
    for (const bad of ['', '180.01', '-181', 'west', '0.1W']) expect(parseLongitude(bad)).toBeUndefined();
  });
});

describe('formatting', () => {
  it('prints a Julian day as a UTC date and minute', () => {
    // 2024-03-08 19:00 UTC.
    expect(formatUtcMinute(2460378.25 + 7 / 24)).toBe('2024-03-09 01:00');
    expect(formatUtcMinute(2460378.0)).toBe('2024-03-08 12:00');
  });

  it('says how long a window lasts in the largest sensible units', () => {
    expect(formatDuration(0)).toBe('0 min');
    expect(formatDuration(45 / 1440)).toBe('45 min');
    expect(formatDuration(1 / 24)).toBe('1 h');
    expect(formatDuration(3.5 / 24)).toBe('3 h 30 min');
    expect(formatDuration(1)).toBe('1 d');
    expect(formatDuration(2 + 1 / 24)).toBe('2 d 1 h');
    // Minutes are dropped once the window is a day or more: they would be noise.
    expect(formatDuration(1 + 30 / 1440)).toBe('1 d');
  });
});

describe('electionRows', () => {
  const window: ElectionWindow = {
    startJd: 2460378.0,
    endJd: 2460378.0 + 3 / 24,
    satisfied: ['mercury-direct'],
    violated: ['moon-not-void'],
  };

  it('turns a window into a row with its UTC times, duration and rules', () => {
    const [row] = electionRows([window]);
    expect(row?.start).toBe('2024-03-08 12:00');
    expect(row?.end).toBe('2024-03-08 15:00');
    expect(row?.duration).toBe('3 h');
    expect(row?.satisfied).toEqual(['mercury-direct']);
    expect(row?.violated).toEqual(['moon-not-void']);
  });

  it('gives distinct windows distinct ids', () => {
    const rows = electionRows([window, { ...window, startJd: window.startJd + 1 }]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });
});

describe('electional screen wiring', () => {
  it('routes #/electional to the screen', () => {
    expect(parseRoute('#/electional')).toEqual({ kind: 'electional' });
    expect(parseRoute('#/electional/')).toEqual({ kind: 'electional' });
  });

  it('offers a half hour, an hour and two hours, with a label in both languages', () => {
    expect(ELECTION_STEP_MINUTES).toEqual([30, 60, 120]);
    for (const messages of [electionalViewMessages.en, electionalViewMessages.nl]) {
      expect(messages.stepOption(30)).toContain('30');
      expect(messages.stepOption(60)).toBeTruthy();
      expect(messages.stepOption(120)).toContain('2');
    }
  });

  it('describes every rule, with its reason, in both languages', () => {
    for (const messages of [electionalViewMessages.en, electionalViewMessages.nl]) {
      for (const key of ELECTION_RULE_KEYS) {
        expect(messages.rules[key]?.label, key).toBeTruthy();
        expect(messages.rules[key]?.explanation, key).toBeTruthy();
      }
    }
  });

  it('words every field error, and the span error with its limit', () => {
    for (const messages of [electionalViewMessages.en, electionalViewMessages.nl]) {
      for (const key of ['fromDate', 'toDate', 'order', 'latitude', 'longitude', 'rules'] as const) {
        expect(messages.fieldErrors[key]).toBeTruthy();
      }
      expect(messages.fieldErrors.span(31)).toContain('31');
    }
  });

  it('pluralises the summary', () => {
    expect(electionalViewMessages.en.summary(1, 1)).toContain('Best 1 window');
    expect(electionalViewMessages.en.summary(5, 3)).toContain('Best 5 windows');
    expect(electionalViewMessages.nl.summary(1, 1)).toContain('1 tijdvak');
  });
});
