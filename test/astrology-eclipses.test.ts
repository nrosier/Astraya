/**
 * Eclipses in a span (#404): the span walk against the real ephemeris and NASA's catalogue, the
 * eclipse degree, and the natal-contact rules in isolation (pure arithmetic on made-up charts).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONTACT_ORB_DEG,
  eclipseContacts,
  findEclipses,
  type Eclipse,
  type NatalPoint,
} from '../src/astrology/eclipses.js';
import type { EphemerisProvider, JulianDayUT } from '../src/ephemeris/types.js';
import { civilFromJulianDay } from '../src/time/julian.js';
import { getEngine } from './engine-harness.js';

let engine: EphemerisProvider;

beforeAll(async () => {
  engine = await getEngine();
}, 60_000);

const day = (jd: JulianDayUT): string => {
  const c = civilFromJulianDay(jd);
  return `${String(c.year)}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`;
};

describe('findEclipses (#404)', () => {
  it('lists every eclipse of 2024 — four, two solar and two lunar, in order — with the catalogue’s dates and kinds', async () => {
    const eclipses = await findEclipses(
      engine,
      await engine.julianDayFromUtc(2024, 1, 1, 0, 0, 0),
      await engine.julianDayFromUtc(2025, 1, 1, 0, 0, 0),
    );
    expect(eclipses.map((e) => `${day(e.maxJd)} ${e.family} ${e.kind}`)).toEqual([
      '2024-03-25 lunar penumbral',
      '2024-04-08 solar total',
      '2024-09-18 lunar partial',
      '2024-10-02 solar annular',
    ]);
  }, 120_000);

  it('places the 8 April 2024 total eclipse at the start of Aries (about 19° Aries), and the lunar eclipse opposite its Sun', async () => {
    const eclipses = await findEclipses(
      engine,
      await engine.julianDayFromUtc(2024, 3, 1, 0, 0, 0),
      await engine.julianDayFromUtc(2024, 5, 1, 0, 0, 0),
    );
    const solar = eclipses.find((e) => e.family === 'solar');
    const lunar = eclipses.find((e) => e.family === 'lunar');
    // The Sun and Moon were in conjunction at 19°24' Aries at the total eclipse.
    expect(solar?.longitude).toBeGreaterThan(19);
    expect(solar?.longitude).toBeLessThan(20);
    // The lunar eclipse two weeks earlier was the Moon at 5° Libra, opposite the Sun at 5° Aries.
    expect(lunar?.longitude).toBeGreaterThan(185);
    expect(lunar?.longitude).toBeLessThan(187);
  }, 120_000);

  it('includes an eclipse on the last day of the range and excludes one just after it', async () => {
    const start = await engine.julianDayFromUtc(2024, 4, 1, 0, 0, 0);
    const through = await findEclipses(engine, start, await engine.julianDayFromUtc(2024, 4, 9, 0, 0, 0));
    expect(through.map((e) => day(e.maxJd))).toContain('2024-04-08');
    const before = await findEclipses(engine, start, await engine.julianDayFromUtc(2024, 4, 8, 0, 0, 0));
    expect(before.map((e) => day(e.maxJd))).not.toContain('2024-04-08');
  }, 120_000);

  it('returns an empty list for a span with no eclipse, and rejects a reversed range', async () => {
    const quiet = await findEclipses(
      engine,
      await engine.julianDayFromUtc(2024, 5, 1, 0, 0, 0),
      await engine.julianDayFromUtc(2024, 6, 1, 0, 0, 0),
    );
    expect(quiet).toEqual([]);
    await expect(findEclipses(engine, 2460500, 2460000)).rejects.toThrow(/before/);
  }, 60_000);

  it('finds about four to seven eclipses a year over a decade, never fewer than four', async () => {
    const eclipses = await findEclipses(
      engine,
      await engine.julianDayFromUtc(2020, 1, 1, 0, 0, 0),
      await engine.julianDayFromUtc(2030, 1, 1, 0, 0, 0),
    );
    const perYear = new Map<number, number>();
    for (const e of eclipses) {
      const y = civilFromJulianDay(e.maxJd).year;
      perYear.set(y, (perYear.get(y) ?? 0) + 1);
    }
    expect(perYear.size).toBe(10);
    for (const count of perYear.values()) {
      expect(count).toBeGreaterThanOrEqual(4);
      expect(count).toBeLessThanOrEqual(7);
    }
  }, 300_000);
});

describe('eclipseContacts', () => {
  const eclipse: Eclipse = {
    family: 'solar',
    kind: 'total',
    maxJd: 2460409,
    startJd: 2460409,
    endJd: 2460409,
    longitude: 19.4,
  };
  const at = (key: string, longitude: number): NatalPoint => ({ key, longitude });

  it('touches a natal point by conjunction with the eclipse degree, within the orb', () => {
    const [contact] = eclipseContacts(eclipse, [at('sun', 21.0)]);
    expect(contact?.pointKey).toBe('sun');
    expect(contact?.kind).toBe('conjunction');
    expect(contact?.orb).toBeCloseTo(1.6, 9);
  });

  it('touches a point by opposition to the eclipse degree — the other end of the axis', () => {
    const [contact] = eclipseContacts(eclipse, [at('moon', 200.0)]);
    expect(contact?.kind).toBe('opposition');
    expect(contact?.orb).toBeCloseTo(0.6, 9);
  });

  it('leaves out a point beyond the orb, and treats the orb edge as inside', () => {
    expect(eclipseContacts(eclipse, [at('mars', 19.4 + DEFAULT_CONTACT_ORB_DEG + 0.01)])).toEqual([]);
    expect(eclipseContacts(eclipse, [at('mars', 19.4 + DEFAULT_CONTACT_ORB_DEG)])).toHaveLength(1);
  });

  it('does not count a square, a trine or any other aspect', () => {
    expect(eclipseContacts(eclipse, [at('a', 19.4 + 90), at('b', 19.4 + 120), at('c', 19.4 + 60)])).toEqual([]);
  });

  it('measures across the 0°/360° boundary', () => {
    const near360: Eclipse = { ...eclipse, longitude: 359.0 };
    const [contact] = eclipseContacts(near360, [at('venus', 1.5)]);
    expect(contact?.kind).toBe('conjunction');
    expect(contact?.orb).toBeCloseTo(2.5, 9);
  });

  it('orders several contacts closest first, and honours a custom orb', () => {
    const contacts = eclipseContacts(eclipse, [at('far', 22.0), at('near', 19.6), at('mid', 20.4)], 5);
    expect(contacts.map((c) => c.pointKey)).toEqual(['near', 'mid', 'far']);
    expect(eclipseContacts(eclipse, [at('far', 22.0)], 1)).toEqual([]);
  });

  it('reports a point at the exact eclipse degree as a conjunction of orb zero', () => {
    expect(eclipseContacts(eclipse, [at('sun', 19.4)])[0]).toEqual({ pointKey: 'sun', kind: 'conjunction', orb: 0 });
  });
});
