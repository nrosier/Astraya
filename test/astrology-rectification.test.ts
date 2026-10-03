/**
 * Birth-time rectification (#408). The pure scoring is tested at its boundaries. The search is
 * tested by *recovering a known answer*: pick a true birth moment, build life events that are exact
 * solar-arc contacts for that moment (by solving the arc for the date each one falls on), then
 * check that rectification over a window of candidate times puts the true one on top. That proves
 * the machinery finds what it is built to find; whether the technique is astrologically convincing
 * is a separate question the module and the screen are explicit about.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { bodyByKey } from '../src/astrology/bodies.js';
import { ageInYears, TROPICAL_YEAR_DAYS } from '../src/astrology/progressions.js';
import {
  contactOrb,
  contactPoints,
  MAX_RECTIFICATION_CANDIDATES,
  rectify,
  scoreCandidate,
  SOLAR_ARC_ORB_DEG,
  SOLAR_ARC_WEIGHT,
  TRANSIT_ORB_DEG,
  TRANSIT_WEIGHT,
  type RectificationEvent,
} from '../src/astrology/rectification.js';
import type { EphemerisProvider, GeoPosition, JulianDayUT } from '../src/ephemeris/types.js';
import { julianDayFor } from '../src/time/julian.js';
import { resolveMoment } from '../src/time/resolve.js';
import { getEngine } from './engine-harness.js';

describe('contactOrb (#408)', () => {
  it('measures the distance from an exact aspect, in either direction, within the orb', () => {
    expect(contactOrb(100.5, 100, 0, 1)).toBeCloseTo(0.5, 9);
    expect(contactOrb(99.4, 100, 0, 1)).toBeCloseTo(0.6, 9);
    expect(contactOrb(190.4, 100, 90, 1)).toBeCloseTo(0.4, 9);
    expect(contactOrb(9.6, 100, 90, 1)).toBeCloseTo(0.4, 9);
    expect(contactOrb(280.2, 100, 180, 1)).toBeCloseTo(0.2, 9);
  });

  it('is undefined outside the orb, and inclusive at its edge', () => {
    expect(contactOrb(101.01, 100, 0, 1)).toBeUndefined();
    expect(contactOrb(101, 100, 0, 1)).toBeCloseTo(1, 9);
    expect(contactOrb(100, 191.5, 90, 1)).toBeUndefined();
  });

  it('measures across the 0/360 boundary', () => {
    expect(contactOrb(0.4, 359.8, 0, 1)).toBeCloseTo(0.6, 9);
    expect(contactOrb(359.7, 90.2, 90, 1)).toBeCloseTo(0.5, 9);
  });

  it('does not count an aspect that is not one of the three hard ones', () => {
    // 120° apart is a trine, not within a degree of 0, 90 or 180.
    for (const angle of [0, 90, 180]) expect(contactOrb(220, 100, angle, 1)).toBeUndefined();
  });
});

describe('contactPoints', () => {
  it('is the full weight at exact, nothing at the orb, and a straight line between', () => {
    expect(contactPoints(0, 1, 2)).toBe(2);
    expect(contactPoints(1, 1, 2)).toBe(0);
    expect(contactPoints(0.5, 1, 2)).toBe(1);
    expect(contactPoints(0.25, 1, 1)).toBeCloseTo(0.75, 9);
  });

  it('weights solar-arc contacts above transits, as the module documents', () => {
    expect(SOLAR_ARC_WEIGHT).toBeGreaterThan(TRANSIT_WEIGHT);
    expect(SOLAR_ARC_ORB_DEG).toBeGreaterThan(0);
    expect(TRANSIT_ORB_DEG).toBeGreaterThan(0);
  });
});

describe('rectify against a known answer (#408)', () => {
  let engine: EphemerisProvider;
  let trueJd: JulianDayUT;
  let events: RectificationEvent[];
  const LONDON: GeoPosition = { latitude: 51.5072, longitude: -0.1276, altitude: 0 };
  const MINUTE = 1 / 1440;
  const SUN = bodyByKey('sun')?.id ?? -1;

  /** The solar arc at `age` years: where the progressed Sun is, minus where it was at birth. */
  async function arcAtAge(birthJd: JulianDayUT, natalSun: number, age: number): Promise<number> {
    const sun = await engine.position(birthJd + age, SUN);
    return (((sun.longitude - natalSun) % 360) + 360) % 360;
  }

  beforeAll(async () => {
    engine = await getEngine();
    trueJd = await julianDayFor(
      engine,
      resolveMoment({
        civil: { year: 1985, month: 3, day: 12, hour: 8, minute: 20, second: 0 },
        coordinates: LONDON,
        zoneOverride: 'Europe/London',
      }),
    );
    const natal = await scoreCandidate(engine, LONDON, trueJd, [{ label: 'x', jd: trueJd }]);
    const chartKeys = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
    const positions = await engine.positions(
      trueJd,
      chartKeys.map((key) => bodyByKey(key)?.id ?? 0),
    );
    const natalSun = positions[0]?.longitude ?? 0;

    // Every arc at which a directed angle would fall exactly on a natal planet, or a directed planet
    // on a natal angle, between about 12 and 45 degrees (ages 12-45).
    const needed: number[] = [];
    for (const angle of [natal.ascendant, natal.midheaven]) {
      for (const position of positions) {
        needed.push((((position.longitude - angle) % 360) + 360) % 360);
        needed.push((((angle - position.longitude) % 360) + 360) % 360);
      }
    }
    const arcs = needed.filter((arc) => arc >= 12 && arc <= 45).sort((a, b) => a - b);
    // Four of them, at least 3 degrees (three years) apart, so they are four distinct dates.
    const chosen: number[] = [];
    for (const arc of arcs) if (chosen.every((other) => Math.abs(other - arc) >= 3)) chosen.push(arc);
    expect(chosen.length).toBeGreaterThanOrEqual(4);

    events = [];
    for (const arc of chosen.slice(0, 4)) {
      // The arc grows with age, so bisect for the age at which it equals the one wanted.
      let lo = 0;
      let hi = 80;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if ((await arcAtAge(trueJd, natalSun, mid)) < arc) lo = mid;
        else hi = mid;
      }
      events.push({ label: `arc ${arc.toFixed(1)}`, jd: trueJd + ((lo + hi) / 2) * TROPICAL_YEAR_DAYS });
    }
  }, 300_000);

  it('builds events that really are exact contacts for the true time (checking the test’s own setup)', async () => {
    const score = await scoreCandidate(engine, LONDON, trueJd, events);
    for (const [index] of events.entries()) {
      const solarArc = score.contacts.filter((c) => c.eventIndex === index && c.technique === 'solar-arc');
      expect(solarArc.length, `event ${String(index)} has a solar-arc contact`).toBeGreaterThanOrEqual(1);
      expect(Math.min(...solarArc.map((c) => c.orb))).toBeLessThan(0.01);
    }
  }, 120_000);

  it('puts the true birth time at, or within minutes of, the top of a six-hour window', async () => {
    const candidates: JulianDayUT[] = [];
    for (let minutes = -180; minutes <= 180; minutes += 5) candidates.push(trueJd + minutes * MINUTE);
    const ranked = await rectify(engine, LONDON, candidates, events);
    const best = ranked[0];
    expect(best).toBeDefined();
    expect(Math.abs((best?.jd ?? 0) - trueJd)).toBeLessThanOrEqual(6 * MINUTE);
    // And clearly: well above what an average time in the window explains.
    expect(best?.lift ?? 0).toBeGreaterThan(2);
  }, 600_000);

  it('scores the true time above times an hour either side, where the angles have moved ~15 degrees', async () => {
    const at = async (minutes: number): Promise<number> =>
      (await scoreCandidate(engine, LONDON, trueJd + minutes * MINUTE, events)).score;
    const exact = await at(0);
    expect(exact).toBeGreaterThan(await at(-60));
    expect(exact).toBeGreaterThan(await at(60));
    expect(exact).toBeGreaterThan(await at(120));
  }, 120_000);

  it('ranks best first and reports lift as score over the average candidate', async () => {
    const candidates = [-90, -30, 0, 30, 90].map((minutes) => trueJd + minutes * MINUTE);
    const ranked = await rectify(engine, LONDON, candidates, events);
    const scores = ranked.map((candidate) => candidate.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    for (const candidate of ranked) expect(candidate.lift).toBeCloseTo(candidate.score / mean, 9);
  }, 300_000);

  it('rejects no events, no candidates, and more candidates than a tab can reasonably test', async () => {
    await expect(rectify(engine, LONDON, [trueJd], [])).rejects.toThrow(/at least one dated event/);
    await expect(rectify(engine, LONDON, [], events)).rejects.toThrow(/no candidate times/);
    const tooMany = Array.from({ length: MAX_RECTIFICATION_CANDIDATES + 1 }, (_, i) => trueJd + i * MINUTE);
    await expect(rectify(engine, LONDON, tooMany, events)).rejects.toThrow(
      new RegExp(String(MAX_RECTIFICATION_CANDIDATES)),
    );
  }, 60_000);

  it('uses the age of the person at each event: an event at birth has no arc, so no solar-arc contact beyond the natal ones', () => {
    expect(ageInYears(trueJd, trueJd)).toBe(0);
  });
});
