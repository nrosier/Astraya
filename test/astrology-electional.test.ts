/**
 * Electional search (#409): the pure rules and window arithmetic at their boundaries, then the
 * search itself against the real ephemeris — anchored on facts that are on public record (the 8
 * March 2024 void-of-course Moon, Mercury's April 2024 retrograde, the March 2024 New and Full
 * Moons) and on an independent recomputation of each rule from raw ephemeris calls.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { bodyByKey } from '../src/astrology/bodies.js';
import { houseOf } from '../src/astrology/emphasis.js';
import {
  ELECTION_RULE_KEYS,
  electionSnapshots,
  electionWindows,
  evaluateRules,
  findElectionWindows,
  MAX_ELECTION_SAMPLES,
  rankWindows,
  type ElectionRuleKey,
  type ElectionSnapshot,
  type ElectionWindow,
} from '../src/astrology/electional.js';
import type { EphemerisProvider, GeoPosition, JulianDayUT } from '../src/ephemeris/types.js';
import { getEngine } from './engine-harness.js';

const ALL = new Set<ElectionRuleKey>(ELECTION_RULE_KEYS);
const only = (...keys: ElectionRuleKey[]): ReadonlySet<ElectionRuleKey> => new Set(keys);

const BASE: ElectionSnapshot = {
  jd: 2460000,
  moonLongitude: 100, // 10° Cancer
  sunLongitude: 40,
  moonVoid: false,
  mercuryRetrograde: false,
  beneficHouses: [2, 6],
  moonAidsBenefic: false,
};

describe('evaluateRules (#409)', () => {
  it('reports only the rules it is asked for', () => {
    expect(Object.keys(evaluateRules(BASE, only('moon-waxing', 'mercury-direct'))).sort()).toEqual([
      'mercury-direct',
      'moon-waxing',
    ]);
    expect(evaluateRules(BASE, new Set())).toEqual({});
  });

  it('is satisfied on every avoid-rule for a quiet sky, and not on the two it lacks', () => {
    const outcome = evaluateRules(BASE, ALL);
    expect(outcome['moon-not-void']).toBe(true);
    expect(outcome['moon-not-via-combusta']).toBe(true);
    expect(outcome['mercury-direct']).toBe(true);
    expect(outcome['moon-not-weak']).toBe(true);
    expect(outcome['moon-waxing']).toBe(true); // Moon 60° ahead of the Sun
    expect(outcome['benefic-angular']).toBe(false); // houses 2 and 6
    expect(outcome['moon-aids-benefic']).toBe(false);
  });

  it('fails the void and retrograde rules when told they hold', () => {
    const outcome = evaluateRules({ ...BASE, moonVoid: true, mercuryRetrograde: true }, ALL);
    expect(outcome['moon-not-void']).toBe(false);
    expect(outcome['mercury-direct']).toBe(false);
  });

  it('treats the Via Combusta as 15° Libra up to but not including 15° Scorpio', () => {
    const at = (moonLongitude: number): boolean | undefined =>
      evaluateRules({ ...BASE, moonLongitude }, only('moon-not-via-combusta'))['moon-not-via-combusta'];
    expect(at(194.99)).toBe(true);
    expect(at(195)).toBe(false);
    expect(at(224.99)).toBe(false);
    expect(at(225)).toBe(true);
  });

  it('calls the Moon weak in Capricorn (detriment) and Scorpio (fall), and nowhere else', () => {
    const weak = (sign: number): boolean | undefined =>
      evaluateRules({ ...BASE, moonLongitude: sign * 30 + 15 }, only('moon-not-weak'))['moon-not-weak'];
    for (let sign = 0; sign < 12; sign++) expect(weak(sign), `sign ${String(sign)}`).toBe(sign !== 9 && sign !== 7);
  });

  it('calls the Moon waxing from the New Moon up to, but not including, the Full Moon', () => {
    const waxing = (elongation: number): boolean | undefined =>
      evaluateRules({ ...BASE, sunLongitude: 0, moonLongitude: elongation }, only('moon-waxing'))['moon-waxing'];
    expect(waxing(0.5)).toBe(true);
    expect(waxing(179.9)).toBe(true);
    expect(waxing(180)).toBe(false);
    expect(waxing(300)).toBe(false);
  });

  it('is satisfied on benefic-angular when Venus or Jupiter stands on any of the four angles', () => {
    const angular = (beneficHouses: number[]): boolean | undefined =>
      evaluateRules({ ...BASE, beneficHouses }, only('benefic-angular'))['benefic-angular'];
    for (const house of [1, 4, 7, 10]) expect(angular([5, house])).toBe(true);
    for (const house of [2, 3, 5, 6, 8, 9, 11, 12]) expect(angular([house, house])).toBe(false);
    expect(angular([])).toBe(false);
  });
});

describe('electionWindows and rankWindows (#409)', () => {
  const STEP = 1 / 24;
  const sample = (hour: number, outcome: Record<string, boolean>) => ({ jd: 100 + hour * STEP, outcome });

  it('merges consecutive samples with the same outcome into one window ending one step after the last', () => {
    const windows = electionWindows(
      [
        sample(0, { 'moon-not-void': true }),
        sample(1, { 'moon-not-void': true }),
        sample(2, { 'moon-not-void': false }),
        sample(3, { 'moon-not-void': false }),
        sample(4, { 'moon-not-void': true }),
      ],
      STEP,
    );
    expect(windows).toHaveLength(3);
    const expected = [
      [100, 100 + 2 * STEP, 1, 0],
      [100 + 2 * STEP, 100 + 4 * STEP, 0, 1],
      [100 + 4 * STEP, 100 + 5 * STEP, 1, 0],
    ] as const;
    expected.forEach(([startJd, endJd, satisfied, violated], index) => {
      // Times are sums of floating-point steps, so they match to far better than a second, not bit for bit.
      expect(windows[index]?.startJd).toBeCloseTo(startJd, 9);
      expect(windows[index]?.endJd).toBeCloseTo(endJd, 9);
      expect(windows[index]?.satisfied).toHaveLength(satisfied);
      expect(windows[index]?.violated).toHaveLength(violated);
    });
  });

  it('keeps the rule order stable and lists satisfied and violated rules separately', () => {
    const [window] = electionWindows(
      [sample(0, { 'moon-waxing': true, 'moon-not-void': false, 'mercury-direct': true })],
      STEP,
    );
    expect(window?.satisfied).toEqual(['mercury-direct', 'moon-waxing']);
    expect(window?.violated).toEqual(['moon-not-void']);
  });

  it('returns no windows for no samples', () => {
    expect(electionWindows([], STEP)).toEqual([]);
  });

  it('ranks by rules satisfied, then by duration, then by earliest', () => {
    const w = (startJd: number, endJd: number, satisfied: ElectionRuleKey[]): ElectionWindow => ({
      startJd,
      endJd,
      satisfied,
      violated: [],
    });
    const ranked = rankWindows(
      [
        w(1, 2, ['moon-waxing']),
        w(5, 9, ['moon-waxing', 'mercury-direct']),
        w(3, 4, ['moon-waxing', 'mercury-direct']),
        w(7, 8, ['moon-waxing', 'mercury-direct']),
        w(10, 12, ['moon-waxing', 'mercury-direct', 'moon-not-void']),
      ],
      10,
    );
    expect(ranked.map((window) => window.startJd)).toEqual([10, 5, 3, 7, 1]);
  });

  it('keeps only the best windows up to the limit', () => {
    const many = Array.from({ length: 10 }, (_, i): ElectionWindow => ({
      startJd: i,
      endJd: i + 1,
      satisfied: ['moon-waxing'],
      violated: [],
    }));
    expect(rankWindows(many, 3)).toHaveLength(3);
  });
});

describe('the election search against the real ephemeris (#409)', () => {
  let engine: EphemerisProvider;
  const LONDON: GeoPosition = { latitude: 51.5072, longitude: -0.1276, altitude: 0 };

  beforeAll(async () => {
    engine = await getEngine();
  }, 60_000);

  const utc = (y: number, m: number, d: number, h = 0, min = 0): Promise<JulianDayUT> =>
    engine.julianDayFromUtc(y, m, d, h, min, 0);

  it('shows the 8 March 2024 void Moon as one window from 19:00 to 02:00 UTC, set against the hours either side', async () => {
    const windows = await findElectionWindows(
      engine,
      LONDON,
      await utc(2024, 3, 8, 12),
      await utc(2024, 3, 9, 6),
      only('moon-not-void'),
      { limit: 10 },
    );
    const violated = windows.filter((w) => w.violated.includes('moon-not-void'));
    expect(violated).toHaveLength(1);
    // The Moon makes its last aspect (Venus) at 18:55 and enters Pisces at 01:03: hourly samples
    // from 19:00 to 01:00 fall inside, and the window ends one step later.
    expect(Math.abs((violated[0]?.startJd ?? 0) - (await utc(2024, 3, 8, 19)))).toBeLessThan(1 / 1440);
    expect(Math.abs((violated[0]?.endJd ?? 0) - (await utc(2024, 3, 9, 2)))).toBeLessThan(1 / 1440);
    expect(windows.filter((w) => w.satisfied.includes('moon-not-void')).length).toBeGreaterThanOrEqual(1);
  }, 300_000);

  it('puts Mercury’s April 2024 retrograde where it was: retrograde mid-April, direct a month later', async () => {
    const retro = await electionSnapshots(engine, LONDON, await utc(2024, 4, 10), await utc(2024, 4, 10, 2), {
      stepMinutes: 60,
    });
    const direct = await electionSnapshots(engine, LONDON, await utc(2024, 5, 10), await utc(2024, 5, 10, 2), {
      stepMinutes: 60,
    });
    expect(retro.every((s) => s.mercuryRetrograde)).toBe(true);
    expect(direct.every((s) => !s.mercuryRetrograde)).toBe(true);
    const first = retro[0];
    expect(first).toBeDefined();
    if (first) expect(evaluateRules(first, only('mercury-direct'))['mercury-direct']).toBe(false);
  }, 120_000);

  it('calls the Moon waxing after the 10 March 2024 New Moon and waning after the 25 March Full Moon', async () => {
    const waxing = await electionSnapshots(engine, LONDON, await utc(2024, 3, 17), await utc(2024, 3, 17, 1));
    const waning = await electionSnapshots(engine, LONDON, await utc(2024, 3, 29), await utc(2024, 3, 29, 1));
    const rule = (s: ElectionSnapshot | undefined): boolean | undefined =>
      s === undefined ? undefined : evaluateRules(s, only('moon-waxing'))['moon-waxing'];
    expect(rule(waxing[0])).toBe(true);
    expect(rule(waning[0])).toBe(false);
  }, 120_000);

  it('agrees, hour by hour across a week, with each rule recomputed independently from raw ephemeris calls', async () => {
    const from = await utc(2024, 3, 11);
    const to = await utc(2024, 3, 18);
    const snapshots = await electionSnapshots(engine, LONDON, from, to, { stepMinutes: 180 });
    const [mercury, venus, jupiter, moon] = ['mercury', 'venus', 'jupiter', 'moon'].map(
      (key) => bodyByKey(key)?.id ?? -1,
    );
    let angularSeen = false;
    let notAngularSeen = false;
    for (const snapshot of snapshots) {
      const [m, v, j, mo] = await engine.positions(snapshot.jd, [mercury ?? 0, venus ?? 0, jupiter ?? 0, moon ?? 0]);
      const houses = await engine.houses(snapshot.jd, LONDON, 'P');
      expect(snapshot.mercuryRetrograde).toBe(m?.retrograde);
      expect(snapshot.moonLongitude).toBeCloseTo(mo?.longitude ?? Number.NaN, 9);
      expect(snapshot.beneficHouses).toEqual([
        houseOf(v?.longitude ?? 0, houses.cusps),
        houseOf(j?.longitude ?? 0, houses.cusps),
      ]);
      if (snapshot.beneficHouses.some((h) => [1, 4, 7, 10].includes(h))) angularSeen = true;
      else notAngularSeen = true;
    }
    // A week of three-hourly charts sweeps Venus and Jupiter through angular and non-angular houses alike.
    expect(angularSeen && notAngularSeen).toBe(true);
  }, 300_000);

  it('finds the Moon aiding a benefic at least once in a month, and not at every sample', async () => {
    const snapshots = await electionSnapshots(engine, LONDON, await utc(2024, 3, 1), await utc(2024, 3, 31), {
      stepMinutes: 120,
    });
    const aiding = snapshots.filter((s) => s.moonAidsBenefic).length;
    expect(aiding).toBeGreaterThan(0);
    expect(aiding).toBeLessThan(snapshots.length);
  }, 300_000);

  it('ranks the best window first and never lists more than the limit', async () => {
    const windows = await findElectionWindows(engine, LONDON, await utc(2024, 3, 11), await utc(2024, 3, 14), ALL, {
      limit: 5,
      stepMinutes: 120,
    });
    expect(windows.length).toBeLessThanOrEqual(5);
    const counts = windows.map((w) => w.satisfied.length);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    for (const window of windows) {
      expect(window.satisfied.length + window.violated.length).toBe(ALL.size);
      expect(window.endJd).toBeGreaterThan(window.startJd);
    }
  }, 300_000);

  it('rejects an empty rule set, a reversed range and a search that would need too many samples', async () => {
    await expect(findElectionWindows(engine, LONDON, 2460000, 2460001, new Set())).rejects.toThrow(/at least one rule/);
    await expect(electionSnapshots(engine, LONDON, 2460001, 2460000)).rejects.toThrow(/before/);
    await expect(electionSnapshots(engine, LONDON, 2460000, 2460000 + 365, { stepMinutes: 1 })).rejects.toThrow(
      new RegExp(String(MAX_ELECTION_SAMPLES)),
    );
  }, 60_000);
});
