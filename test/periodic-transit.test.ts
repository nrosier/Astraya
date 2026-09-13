/**
 * Integration tests for computePeriodicTransitForecast (#207).
 *
 * Runs against the real Swiss Ephemeris engine: the point is that the four
 * tiers combine correctly through the real natal chart, `findExactTransit-
 * Aspects` and `findStations`, which a mocked provider couldn't demonstrate.
 */
import { describe, expect, it } from 'vitest';
import { angularSeparation } from '../src/astrology/aspects.js';
import { computePeriodicTransitForecast, type PeriodicTransitPeriods } from '../src/domain/periodic-transit.js';
import { SE } from '../src/ephemeris/generated-constants.js';
import { julianDayFor } from '../src/time/julian.js';
import { resolveMoment } from '../src/time/resolve.js';
import type { BirthMomentInput } from '../src/time/types.js';
import { getEngine } from './engine-harness.js';

const NATAL: BirthMomentInput = {
  civil: { year: 1990, month: 6, day: 15, hour: 14, minute: 30, second: 0 },
  coordinates: { latitude: 38.7478, longitude: -85.0672 },
  offsetOverrideMinutes: -300,
};

async function periodsFor(dayJd: number): Promise<PeriodicTransitPeriods> {
  return { dayJd, monthFromJd: dayJd, monthToJd: dayJd + 30, year: 2020 };
}

describe('computePeriodicTransitForecast (#207)', () => {
  it('computes all four tiers off one natal chart', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const dayJd = natalJd + 365.2425 * 30;
    const periods = await periodsFor(dayJd);

    const forecast = await computePeriodicTransitForecast(NATAL, periods, engine);

    expect(forecast.natal.positions.length).toBeGreaterThan(0);
    expect(forecast.daily.jd).toBe(dayJd);
    expect(forecast.daily.moon.sign).toBeGreaterThanOrEqual(0);
    expect(forecast.daily.moon.sign).toBeLessThan(12);
    expect(forecast.daily.moon.house).toBeGreaterThanOrEqual(1);
    expect(forecast.daily.moon.house).toBeLessThanOrEqual(12);
    expect(forecast.weekly.toJd - forecast.weekly.fromJd).toBe(7);
    expect(forecast.monthly.fromJd).toBe(periods.monthFromJd);
    expect(forecast.monthly.toJd).toBe(periods.monthToJd);
    expect(forecast.yearly.solarReturn.year).toBe(2020);
  });

  it('finds exact weekly/monthly aspects that genuinely land at the aspect angle from the natal body', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const dayJd = natalJd + 365.2425 * 30;
    const periods = await periodsFor(dayJd);

    const forecast = await computePeriodicTransitForecast(NATAL, periods, engine);
    expect(forecast.monthly.events.length).toBeGreaterThan(0);

    for (const event of forecast.monthly.events) {
      const [transitingPosition] = await engine.positions(event.jd, [event.transitingBody]);
      const natalPosition = forecast.natal.positions.find((p) => p.body === event.natalBody);
      if (transitingPosition === undefined || natalPosition === undefined) {
        throw new Error('unreachable: index within bounds');
      }
      const separation = angularSeparation(transitingPosition.longitude, natalPosition.longitude);
      expect(Math.abs(separation - event.aspect.angle)).toBeLessThan(0.001);
    }
  });

  it('never includes the Moon in the weekly/monthly body set', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const dayJd = natalJd + 365.2425 * 30;
    const periods = await periodsFor(dayJd);

    const forecast = await computePeriodicTransitForecast(NATAL, periods, engine);
    const moonId = forecast.daily.moon.position.body;
    for (const event of [...forecast.weekly.events, ...forecast.monthly.events]) {
      expect(event.transitingBody).not.toBe(moonId);
    }
  });

  it('keeps weekly a subset (by window) of a wider monthly window over the same start', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const dayJd = natalJd + 365.2425 * 30;
    const periods = await periodsFor(dayJd);

    const forecast = await computePeriodicTransitForecast(NATAL, periods, engine);
    for (const event of forecast.weekly.events) {
      expect(event.jd).toBeGreaterThanOrEqual(forecast.weekly.fromJd);
      expect(event.jd).toBeLessThanOrEqual(forecast.weekly.toJd);
    }
    for (const event of forecast.monthly.events) {
      expect(event.jd).toBeGreaterThanOrEqual(forecast.monthly.fromJd);
      expect(event.jd).toBeLessThanOrEqual(forecast.monthly.toJd);
    }
  });

  it("computes the transiting Sun's natal sign/house for the month", async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const dayJd = natalJd + 365.2425 * 30;
    const periods = await periodsFor(dayJd);

    const forecast = await computePeriodicTransitForecast(NATAL, periods, engine);
    expect(forecast.monthly.sun.sign).toBeGreaterThanOrEqual(0);
    expect(forecast.monthly.sun.sign).toBeLessThan(12);
    expect(forecast.monthly.sun.house).toBeGreaterThanOrEqual(1);
    expect(forecast.monthly.sun.house).toBeLessThanOrEqual(12);
  });

  it('ties the yearly tier to a real solar return matching the natal Sun longitude', async () => {
    const engine = await getEngine();
    const natalJd = await julianDayFor(engine, resolveMoment(NATAL));
    const dayJd = natalJd + 365.2425 * 30;
    const periods = await periodsFor(dayJd);

    const forecast = await computePeriodicTransitForecast(NATAL, periods, engine);
    const [natalSun] = await engine.positions(natalJd, [SE.SE_SUN]);
    const returnSun = forecast.yearly.solarReturn.positions.find((p) => p.body === SE.SE_SUN);
    if (natalSun === undefined || returnSun === undefined) throw new Error('unreachable: index within bounds');

    expect(angularSeparation(returnSun.longitude, natalSun.longitude)).toBeLessThan(0.01);
    expect(forecast.yearly.solarReturn.year).toBe(2020);
    expect(forecast.yearly.solarReturn.houses.cusps).toHaveLength(13);
  });
});
