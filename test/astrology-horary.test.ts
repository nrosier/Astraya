/**
 * Horary considerations before judgment (#406): the pure rules at their exact boundaries, then
 * the whole path against the real ephemeris over a month of charts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  horaryConsiderations,
  isRadical,
  type HoraryConsiderationKey,
  type HoraryInput,
} from '../src/astrology/horary.js';
import { computeHoraryChart } from '../src/domain/horary.js';
import type { EphemerisProvider } from '../src/ephemeris/types.js';
import type { BirthMomentInput } from '../src/time/types.js';
import { getEngine } from './engine-harness.js';

const BASE: HoraryInput = { ascendant: 45, moonLongitude: 100, saturnHouse: 3, moonIsVoid: false };

function applying(input: Partial<HoraryInput>): readonly HoraryConsiderationKey[] {
  return horaryConsiderations({ ...BASE, ...input })
    .filter((consideration) => consideration.applies)
    .map((consideration) => consideration.key);
}

describe('horaryConsiderations (#406)', () => {
  it('lists all five considerations, none applying, for an unremarkable chart', () => {
    const all = horaryConsiderations(BASE);
    expect(all.map((c) => c.key)).toEqual([
      'ascendant-too-early',
      'ascendant-too-late',
      'moon-void-of-course',
      'moon-via-combusta',
      'saturn-in-seventh',
    ]);
    expect(applying({})).toEqual([]);
    expect(isRadical(all)).toBe(true);
  });

  it('calls the Ascendant too early below 3° into its sign — and exactly 3° is fine', () => {
    expect(applying({ ascendant: 30 + 0.0 })).toEqual(['ascendant-too-early']);
    expect(applying({ ascendant: 30 + 2.99 })).toEqual(['ascendant-too-early']);
    expect(applying({ ascendant: 30 + 3.0 })).toEqual([]);
  });

  it('calls the Ascendant too late above 27° into its sign — and exactly 27° is fine', () => {
    expect(applying({ ascendant: 60 + 27.0 })).toEqual([]);
    expect(applying({ ascendant: 60 + 27.01 })).toEqual(['ascendant-too-late']);
    expect(applying({ ascendant: 60 + 29.99 })).toEqual(['ascendant-too-late']);
  });

  it('measures the degree within the sign wherever the sign sits, including the last one', () => {
    expect(applying({ ascendant: 330 + 1 })).toEqual(['ascendant-too-early']);
    expect(applying({ ascendant: 359.5 })).toEqual(['ascendant-too-late']);
    expect(applying({ ascendant: 0.5 })).toEqual(['ascendant-too-early']);
  });

  it('treats the Via Combusta as 15° Libra up to but not including 15° Scorpio', () => {
    expect(applying({ moonLongitude: 194.99 })).toEqual([]);
    expect(applying({ moonLongitude: 195 })).toEqual(['moon-via-combusta']);
    expect(applying({ moonLongitude: 210 })).toEqual(['moon-via-combusta']);
    expect(applying({ moonLongitude: 224.99 })).toEqual(['moon-via-combusta']);
    expect(applying({ moonLongitude: 225 })).toEqual([]);
  });

  it('wraps a longitude outside 0-360 before testing the Via Combusta', () => {
    expect(applying({ moonLongitude: 210 + 360 })).toEqual(['moon-via-combusta']);
    expect(applying({ moonLongitude: 210 - 360 })).toEqual(['moon-via-combusta']);
  });

  it('flags a void Moon only when told it is void', () => {
    expect(applying({ moonIsVoid: true })).toEqual(['moon-void-of-course']);
    expect(applying({ moonIsVoid: false })).toEqual([]);
  });

  it('flags Saturn in the seventh house only', () => {
    expect(applying({ saturnHouse: 7 })).toEqual(['saturn-in-seventh']);
    for (const house of [1, 2, 6, 8, 12]) expect(applying({ saturnHouse: house })).toEqual([]);
    expect(applying({ saturnHouse: undefined })).toEqual([]);
  });

  it('reports every consideration that applies together, and is no longer radical', () => {
    const input: HoraryInput = { ascendant: 31, moonLongitude: 200, saturnHouse: 7, moonIsVoid: true };
    expect(applying(input)).toEqual([
      'ascendant-too-early',
      'moon-void-of-course',
      'moon-via-combusta',
      'saturn-in-seventh',
    ]);
    expect(isRadical(horaryConsiderations(input))).toBe(false);
  });

  it('applies neither Ascendant caution when there is no Ascendant to judge (NaN)', () => {
    expect(applying({ ascendant: Number.NaN })).toEqual([]);
  });
});

describe('computeHoraryChart (#406)', () => {
  let engine: EphemerisProvider;

  beforeAll(async () => {
    engine = await getEngine();
  }, 60_000);

  const LONDON = { latitude: 51.5072, longitude: -0.1276 };

  function momentAt(dayOffset: number): BirthMomentInput {
    const totalMinutes = Math.round(dayOffset * 1440);
    const day = 1 + Math.floor(totalMinutes / 1440);
    const minuteOfDay = totalMinutes % 1440;
    return {
      civil: { year: 2024, month: 3, day, hour: Math.floor(minuteOfDay / 60), minute: minuteOfDay % 60, second: 0 },
      coordinates: LONDON,
      zoneOverride: 'Europe/London',
    };
  }

  it('casts a chart in Regiomontanus by default, with the houses available at London', async () => {
    const chart = await computeHoraryChart(momentAt(0.5), engine);
    expect(chart.housesAvailable).toBe(true);
    expect(chart.data.houses.system).toBe('R');
    expect(chart.considerations).toHaveLength(5);
  }, 60_000);

  it('honours a different house system', async () => {
    const chart = await computeHoraryChart(momentAt(0.5), engine, 'P');
    expect(chart.data.houses.system).toBe('P');
  }, 60_000);

  it('hits every consideration, and misses it too, across a month of charts — each agreeing with the chart’s own figures', async () => {
    const seen = new Map<HoraryConsiderationKey, { yes: number; no: number }>();
    // 3.29-hour steps: coprime with the day, so the Ascendant's phase sweeps through every sign
    // degree rather than repeating at four fixed times.
    for (let i = 0; i < 200; i++) {
      const chart = await computeHoraryChart(momentAt(i * 0.1371), engine);
      const asc = chart.data.houses.ascendant % 30;
      const moon = chart.data.positions.find((p) => p.body === 1)?.longitude ?? Number.NaN;
      const byKey = new Map(chart.considerations.map((c) => [c.key, c.applies]));
      expect(byKey.get('ascendant-too-early')).toBe(asc < 3);
      expect(byKey.get('ascendant-too-late')).toBe(asc > 27);
      expect(byKey.get('moon-via-combusta')).toBe(moon >= 195 && moon < 225);
      expect(byKey.get('moon-void-of-course')).toBe(chart.voidOfCourse.isVoid);
      for (const consideration of chart.considerations) {
        const tally = seen.get(consideration.key) ?? { yes: 0, no: 0 };
        if (consideration.applies) tally.yes++;
        else tally.no++;
        seen.set(consideration.key, tally);
      }
    }
    for (const key of [
      'ascendant-too-early',
      'ascendant-too-late',
      'moon-void-of-course',
      'moon-via-combusta',
      'saturn-in-seventh',
    ] as const) {
      const tally = seen.get(key);
      expect(tally?.yes, `${key} never applied in 200 charts`).toBeGreaterThan(0);
      expect(tally?.no, `${key} always applied`).toBeGreaterThan(0);
    }
  }, 600_000);

  it('falls back to Porphyry inside the polar circle, and says so, still with an Ascendant to judge', async () => {
    const polar: BirthMomentInput = {
      civil: { year: 2024, month: 3, day: 1, hour: 12, minute: 0, second: 0 },
      coordinates: { latitude: 78.2, longitude: 15.6 },
      zoneOverride: 'Arctic/Longyearbyen',
    };
    const chart = await computeHoraryChart(polar, engine, 'P');
    // Placidus is undefined there; the engine switches to Porphyry and records why.
    expect(chart.data.houses.system).toBe('O');
    expect(chart.data.houses.warning).toContain('undefined at latitude');
    expect(chart.housesAvailable).toBe(true);
    expect(Number.isFinite(chart.data.houses.ascendant)).toBe(true);
  }, 60_000);
});
