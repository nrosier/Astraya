import { describe, expect, it } from 'vitest';
import { ASPECTS } from '../src/astrology/aspects.js';
import type { MutualAspectEvent } from '../src/astrology/mutual-aspects.js';
import { renderCycleDiagramSvg } from '../src/chart/cycle-diagram.js';
import {
  CYCLE_ASPECT_KEYS,
  CYCLE_BODY_KEYS,
  CYCLE_PRESETS,
  clampCycleYear,
  cycleRows,
  filterByMotion,
  MAX_CYCLE_YEAR,
  MIN_CYCLE_YEAR,
} from '../src/ui/cycles.js';
import { parseRoute } from '../src/ui/route.js';
import { cyclesViewMessages } from '../src/ui/CyclesView.messages.js';

const conjunction = ASPECTS.find((aspect) => aspect.key === 'conjunction');
if (!conjunction) throw new Error('fixture bug: no conjunction');

// 2020-12-21 18:00 UTC and 2040-10-31 12:00 UTC, the great conjunctions.
const GREAT_2020: MutualAspectEvent = {
  jd: 2459205.25,
  aspect: conjunction,
  longitudeA: 300.4833, // 0°29' Aquarius
  longitudeB: 300.4833,
  retrogradeA: false,
  retrogradeB: false,
};
const GREAT_2040: MutualAspectEvent = {
  jd: 2466825.0,
  aspect: conjunction,
  longitudeA: 207.0,
  longitudeB: 207.0,
  retrogradeA: true,
  retrogradeB: false,
};

describe('cycleRows', () => {
  it('formats the date in UTC and the position as sign plus degree and minute', () => {
    const [row] = cycleRows([GREAT_2020]);
    expect(row?.date).toBe('2020-12-21 18:00');
    expect(row?.signName).toBe('Aquarius');
    expect(row?.position).toBe("0°29'");
  });

  it('gives the years since the previous row, and nothing for the first', () => {
    const rows = cycleRows([GREAT_2020, GREAT_2040]);
    expect(rows[0]?.yearsSincePrevious).toBeUndefined();
    expect(rows[1]?.yearsSincePrevious).toBeCloseTo((GREAT_2040.jd - GREAT_2020.jd) / 365.2425, 9);
    expect(rows[1]?.yearsSincePrevious).toBeCloseTo(20.84, 1);
  });

  it("rounds to the minute across the end of the zodiac: 359°59'.4 stays in Pisces, a hair more wraps to Aries", () => {
    const [stays] = cycleRows([{ ...GREAT_2020, longitudeA: 359.99 }]);
    expect(stays?.signName).toBe('Pisces');
    expect(stays?.position).toBe("29°59'");
    // 359.9999° is 21599.994 minutes, which rounds to the full circle — 0°00' Aries, never 30°00' Pisces.
    const [wraps] = cycleRows([{ ...GREAT_2020, longitudeA: 359.9999 }]);
    expect(wraps?.signName).toBe('Aries');
    expect(wraps?.position).toBe("0°00'");
  });
});

describe('filterByMotion', () => {
  it('keeps everything, only the retrograde ones, or only the direct ones — by the first body', () => {
    const both = [GREAT_2020, GREAT_2040];
    expect(filterByMotion(both, 'all')).toEqual(both);
    expect(filterByMotion(both, 'retrograde')).toEqual([GREAT_2040]);
    expect(filterByMotion(both, 'direct')).toEqual([GREAT_2020]);
  });
});

describe('clampCycleYear', () => {
  it('keeps a year inside the range the ephemeris covers, and clamps one outside it', () => {
    expect(clampCycleYear('2020')).toBe(2020);
    expect(clampCycleYear(' 2020 ')).toBe(2020);
    expect(clampCycleYear('1500')).toBe(MIN_CYCLE_YEAR);
    expect(clampCycleYear('9999')).toBe(MAX_CYCLE_YEAR);
  });

  it('rejects anything that is not a whole number', () => {
    for (const bad of ['', 'abc', '20.5', '2e3', '-', '2020x']) expect(clampCycleYear(bad)).toBeUndefined();
  });
});

describe('presets', () => {
  it('only name bodies and aspects the screen offers, and have a label in both languages', () => {
    for (const preset of CYCLE_PRESETS) {
      expect(CYCLE_BODY_KEYS).toContain(preset.bodyA);
      expect(CYCLE_BODY_KEYS).toContain(preset.bodyB);
      expect(preset.bodyA).not.toBe(preset.bodyB);
      expect(CYCLE_ASPECT_KEYS).toContain(preset.aspect);
      expect(cyclesViewMessages.en.presets[preset.key]).toBeTruthy();
      expect(cyclesViewMessages.nl.presets[preset.key]).toBeTruthy();
    }
  });

  it('keep every fixed span inside the ephemeris range', () => {
    for (const preset of CYCLE_PRESETS) {
      if ('from' in preset.span) {
        expect(preset.span.from).toBeGreaterThanOrEqual(MIN_CYCLE_YEAR);
        // `to` may extend past 2399 only by clamping at run time; the shipped presets stay inside 2200.
        expect(preset.span.to).toBeLessThanOrEqual(MAX_CYCLE_YEAR);
      }
    }
  });

  it('offer the Venus pentagram as retrograde-only, which is what isolates the inferior conjunctions', () => {
    expect(CYCLE_PRESETS.find((preset) => preset.key === 'venus-pentagram')?.motion).toBe('retrograde');
  });
});

describe('route', () => {
  it('routes #/cycles to the screen', () => {
    expect(parseRoute('#/cycles')).toEqual({ kind: 'cycles' });
    expect(parseRoute('#/cycles/')).toEqual({ kind: 'cycles' });
  });
});

describe('renderCycleDiagramSvg', () => {
  const pentagram = [0, 215.6, 71.2, 286.8, 142.4, 358].map((longitude, index) => ({
    longitude,
    label: String(index + 1),
  }));

  it('draws the zodiac ring with all twelve signs, element-coloured, and no cycle points when given none', () => {
    const svg = renderCycleDiagramSvg([]);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.split('class="cycle-sign-boundary"').length - 1).toBe(12);
    expect(svg.split('chart-sign-glyph chart-sign-glyph-').length - 1).toBe(12);
    expect(svg).toContain('chart-sign-element-fire');
    expect(svg).not.toContain('cycle-point"');
    expect(svg).not.toContain('cycle-link');
  });

  it('plots one labelled point per event and one link between each consecutive pair', () => {
    const svg = renderCycleDiagramSvg(pentagram);
    expect(svg.split('class="cycle-point"').length - 1).toBe(6);
    expect(svg.split('class="cycle-link"').length - 1).toBe(5);
    for (let i = 1; i <= 6; i++) expect(svg).toContain(`>${String(i)}<`);
  });

  it('puts 0° Aries at twelve o’clock and runs counterclockwise: 90° is a quarter turn left', () => {
    const size = 400;
    const svg = renderCycleDiagramSvg(
      [
        { longitude: 0, label: 'a' },
        { longitude: 90, label: 'b' },
      ],
      size,
    );
    const points = [...svg.matchAll(/<circle cx="([\d.-]+)" cy="([\d.-]+)" r="[\d.]+" class="cycle-point"/g)].map(
      (match) => [Number(match[1]), Number(match[2])] as const,
    );
    expect(points).toHaveLength(2);
    const [aries, cancer] = points;
    expect(aries?.[0]).toBeCloseTo(size / 2, 1);
    expect(aries?.[1]).toBeLessThan(size / 2);
    expect(cancer?.[0]).toBeLessThan(size / 2);
    expect(cancer?.[1]).toBeCloseTo(size / 2, 1);
  });

  it('moves the label of a point that nearly coincides with an earlier one, so they do not overprint', () => {
    const size = 400;
    const svg = renderCycleDiagramSvg(
      [
        { longitude: 100, label: '1' },
        { longitude: 102, label: '2' },
        { longitude: 250, label: '3' },
      ],
      size,
    );
    const label = (text: string): readonly [number, number] => {
      const match = new RegExp(`<text x="([\\d.-]+)" y="([\\d.-]+)"[^>]*class="cycle-point-label">${text}<`).exec(svg);
      if (!match) throw new Error(`no label ${text}`);
      return [Number(match[1]), Number(match[2])];
    };
    const centre = size / 2;
    const radius = (point: readonly [number, number]): number => Math.hypot(point[0] - centre, point[1] - centre);
    // Labels 1 and 2 are two degrees apart, so 2 sits further in; the isolated 3 is at the normal radius.
    expect(radius(label('2'))).toBeLessThan(radius(label('1')) - size * 0.03);
    expect(Math.abs(radius(label('3')) - radius(label('1')))).toBeLessThan(2);
  });

  it('escapes a label rather than injecting it', () => {
    const svg = renderCycleDiagramSvg([{ longitude: 10, label: '<b>"x"</b>' }]);
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&lt;b&gt;');
  });
});
