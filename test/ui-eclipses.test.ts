import { describe, expect, it } from 'vitest';
import type { Eclipse, EclipseContact } from '../src/astrology/eclipses.js';
import { eclipseRows, MAX_ECLIPSE_SPAN_YEARS } from '../src/ui/eclipses.js';
import { eclipsesViewMessages } from '../src/ui/EclipsesView.messages.js';
import { parseRoute } from '../src/ui/route.js';

// The total solar eclipse of 8 April 2024, greatest eclipse 18:17 UTC, at 19°24' Aries.
const TOTAL_2024: Eclipse = {
  family: 'solar',
  kind: 'total',
  maxJd: 2460409.2620414216,
  startJd: 2460409.1543619735,
  endJd: 2460409.3695437848,
  longitude: 19.4,
};
const PARTIAL_LUNAR: Eclipse = { ...TOTAL_2024, family: 'lunar', kind: 'partial', maxJd: 2460571.6, longitude: 356.0 };

describe('eclipseRows (#404)', () => {
  it('formats the greatest-eclipse moment in UTC and the degree as sign plus degree and minute', () => {
    const [row] = eclipseRows([TOTAL_2024]);
    expect(row?.date).toBe('2024-04-08 18:17');
    expect(row?.signName).toBe('Aries');
    expect(row?.position).toBe("19°24'");
    expect(row?.family).toBe('solar');
    expect(row?.kind).toBe('total');
  });

  it('gives each row a unique id even when a solar and a lunar eclipse are close together', () => {
    const rows = eclipseRows([TOTAL_2024, { ...PARTIAL_LUNAR, maxJd: TOTAL_2024.maxJd }]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2);
  });

  it('attaches contacts from the lookup it is given, and none when it is given none', () => {
    const contact: EclipseContact = { pointKey: 'sun', kind: 'conjunction', orb: 1.2 };
    const withContacts = eclipseRows([TOTAL_2024], () => [contact]);
    expect(withContacts[0]?.contacts).toEqual([contact]);
    expect(eclipseRows([TOTAL_2024])[0]?.contacts).toEqual([]);
  });

  it('puts a longitude just under 360° in Pisces, and one that rounds up to the full circle in Aries', () => {
    expect(eclipseRows([{ ...TOTAL_2024, longitude: 359.99 }])[0]?.signName).toBe('Pisces');
    expect(eclipseRows([{ ...TOTAL_2024, longitude: 359.9999 }])[0]?.signName).toBe('Aries');
  });

  it('returns no rows for no eclipses', () => {
    expect(eclipseRows([])).toEqual([]);
  });
});

describe('eclipses screen wiring', () => {
  it('routes #/eclipses to the screen', () => {
    expect(parseRoute('#/eclipses')).toEqual({ kind: 'eclipses' });
    expect(parseRoute('#/eclipses/')).toEqual({ kind: 'eclipses' });
  });

  it('refuses a span long enough to be unreadable', () => {
    expect(MAX_ECLIPSE_SPAN_YEARS).toBeGreaterThanOrEqual(10);
    expect(MAX_ECLIPSE_SPAN_YEARS).toBeLessThanOrEqual(100);
  });

  it('names every solar and lunar kind in both languages', () => {
    for (const messages of [eclipsesViewMessages.en, eclipsesViewMessages.nl]) {
      for (const kind of ['total', 'annular', 'hybrid', 'partial'] as const) {
        expect(messages.solarKinds[kind]).toBeTruthy();
      }
      for (const kind of ['total', 'partial', 'penumbral'] as const) {
        expect(messages.lunarKinds[kind]).toBeTruthy();
      }
      expect(messages.families.solar).toBeTruthy();
      expect(messages.families.lunar).toBeTruthy();
    }
  });

  it('writes a natal contact as the point, the aspect and the orb', () => {
    expect(eclipsesViewMessages.en.contact('Sun', 'Conjunction', '1.2°')).toBe('Sun Conjunction 1.2°');
  });
});
