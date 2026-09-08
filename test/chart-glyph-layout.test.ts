import { describe, expect, it } from 'vitest';
import { renderGlyphRingSvg, spreadGlyphs } from '../src/chart/glyph-layout.js';

/** Smallest gap between adjacent display longitudes, walking the circle in input order. */
function minGap(points: readonly { displayLongitude: number }[]): number {
  let smallest = Infinity;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i]?.displayLongitude;
    const b = points[i + 1]?.displayLongitude;
    if (a === undefined || b === undefined) continue;
    smallest = Math.min(smallest, b - a);
  }
  return smallest;
}

describe('spreadGlyphs (#41)', () => {
  it('returns an empty array for no points, and the point unchanged for a single point', () => {
    expect(spreadGlyphs([])).toEqual([]);
    const single = spreadGlyphs([{ key: 'sun', longitude: 123.4 }]);
    expect(single).toEqual([{ key: 'sun', longitude: 123.4, displayLongitude: 123.4 }]);
  });

  it('leaves already-separated glyphs exactly where they are', () => {
    const input = [
      { key: 'sun', longitude: 10 },
      { key: 'moon', longitude: 100 },
      { key: 'mars', longitude: 250 },
    ];
    const result = spreadGlyphs(input, 6);
    expect(result.map((r) => r.displayLongitude)).toEqual([10, 100, 250]);
  });

  it('spreads a deliberately tight stellium — three planets within 2 degrees — to the minimum separation', () => {
    // Sun, Mercury and Venus all within a 2-degree span, the checklist's example case.
    const input = [
      { key: 'sun', longitude: 74.5 },
      { key: 'mercury', longitude: 75.2 },
      { key: 'venus', longitude: 73.8 },
    ];
    const result = spreadGlyphs(input, 6);
    expect(result).toHaveLength(3);
    // Order along the circle is preserved: venus (73.8) < sun (74.5) < mercury (75.2).
    const byKey = new Map(result.map((r) => [r.key, r]));
    const venus = byKey.get('venus');
    const sun = byKey.get('sun');
    const mercury = byKey.get('mercury');
    expect(venus).toBeDefined();
    expect(sun).toBeDefined();
    expect(mercury).toBeDefined();
    if (!venus || !sun || !mercury) throw new Error('unreachable');
    expect(venus.displayLongitude).toBeLessThan(sun.displayLongitude);
    expect(sun.displayLongitude).toBeLessThan(mercury.displayLongitude);
    expect(sun.displayLongitude - venus.displayLongitude).toBeCloseTo(6, 6);
    expect(mercury.displayLongitude - sun.displayLongitude).toBeCloseTo(6, 6);
    // True longitude is preserved unchanged for leader-line rendering.
    expect(venus.longitude).toBe(73.8);
    expect(sun.longitude).toBe(74.5);
    expect(mercury.longitude).toBe(75.2);
  });

  it('spreads a five-body stellium with every adjacent gap at least the minimum', () => {
    const input = [
      { key: 'a', longitude: 100 },
      { key: 'b', longitude: 100.5 },
      { key: 'c', longitude: 101 },
      { key: 'd', longitude: 101.5 },
      { key: 'e', longitude: 102 },
    ];
    const result = spreadGlyphs(input, 6);
    expect(minGap(result)).toBeGreaterThanOrEqual(6 - 1e-6);
  });

  it('produces the same output for the same input (deterministic)', () => {
    const input = [
      { key: 'sun', longitude: 74.5 },
      { key: 'mercury', longitude: 75.2 },
      { key: 'venus', longitude: 73.8 },
      { key: 'mars', longitude: 200 },
    ];
    expect(spreadGlyphs(input, 6)).toEqual(spreadGlyphs(input, 6));
  });

  it('breaks exact-longitude ties by input order rather than arbitrarily', () => {
    const input = [
      { key: 'first', longitude: 50 },
      { key: 'second', longitude: 50 },
    ];
    const result = spreadGlyphs(input, 6);
    const byKey = new Map(result.map((r) => [r.key, r]));
    const first = byKey.get('first');
    const second = byKey.get('second');
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) throw new Error('unreachable');
    expect(first.displayLongitude).toBeLessThan(second.displayLongitude);
  });

  it('cuts at the largest gap so a stellium straddling the 0/360 wrap point spreads correctly', () => {
    const input = [
      { key: 'a', longitude: 359 },
      { key: 'b', longitude: 0.5 },
      { key: 'c', longitude: 2 },
    ];
    const result = spreadGlyphs(input, 6);
    const byKey = new Map(result.map((r) => [r.key, r]));
    const a = byKey.get('a');
    const b = byKey.get('b');
    const c = byKey.get('c');
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(c).toBeDefined();
    if (!a || !b || !c) throw new Error('unreachable');
    // Circular order a -> b -> c must be preserved, walking forward through the wrap.
    expect(norm360Diff(a.displayLongitude, b.displayLongitude)).toBeGreaterThan(0);
    expect(norm360Diff(b.displayLongitude, c.displayLongitude)).toBeGreaterThan(0);
  });
});

/** Forward circular distance from a to b, in (0, 360]. */
function norm360Diff(a: number, b: number): number {
  const diff = (b - a + 360) % 360;
  return diff === 0 ? 360 : diff;
}

describe('renderGlyphRingSvg (#41)', () => {
  it('draws a leader line only for glyphs that actually moved', () => {
    const positions = [
      { key: 'sun', longitude: 10 }, // isolated: no leader line needed
      { key: 'moon', longitude: 100.1 }, // clustered with mercury below
      { key: 'mercury', longitude: 100 },
    ];
    const svg = renderGlyphRingSvg(positions, 0, 300, 300, 250, 280);
    expect(svg).toContain('chart-glyph-sun');
    expect(svg).toContain('chart-glyph-moon');
    expect(svg).toContain('chart-glyph-mercury');
    expect(svg.split('class="chart-glyph-leader"').length - 1).toBe(2);
  });

  it('skips an unrecognised body key without throwing', () => {
    const positions = [{ key: 'notARealBody', longitude: 10 }];
    expect(() => renderGlyphRingSvg(positions, 0, 300, 300, 250, 280)).not.toThrow();
    expect(renderGlyphRingSvg(positions, 0, 300, 300, 250, 280)).toBe('');
  });

  it('produces well-formed <line> and glyph <g> markup', () => {
    const positions = [
      { key: 'sun', longitude: 74.5 },
      { key: 'mercury', longitude: 75.2 },
    ];
    const svg = renderGlyphRingSvg(positions, 0, 300, 300, 250, 280);
    expect(svg).toContain('<line ');
    expect(svg).toContain('<g transform="translate(');
  });
});
