import { describe, expect, it } from 'vitest';
import type { ChartSheetInput } from '../src/chart/chart-sheet.js';
import { renderChartSheetSvg } from '../src/chart/chart-sheet.js';
import type { HousePositions } from '../src/ephemeris/types.js';

function houses(ascendant: number): HousePositions {
  const cusps = [0, ...Array.from({ length: 12 }, (_, index) => (ascendant + index * 30) % 360)];
  return {
    cusps,
    ascendant,
    midheaven: (ascendant + 270) % 360,
    armc: (ascendant + 270) % 360,
    vertex: 0,
    equatorialAscendant: 0,
    coAscendantKoch: 0,
    coAscendantMunkasey: 0,
    polarAscendant: 0,
    system: 'P',
  };
}

const BODIES = [
  { body: 0 as const, key: 'sun', label: 'Sun', longitude: 10.5 },
  { body: 1 as const, key: 'moon', label: 'Moon', longitude: 130.5 },
  { body: 2 as const, key: 'mercury', label: 'Mercury', longitude: 100.25 },
];

const input: ChartSheetInput = {
  metaLines: ['Ada Lovelace', 'Placidus · Tropical', "London, 51°30'N 0°07'W"],
  rings: [{ label: 'Natal', houses: houses(15), bodies: BODIES }],
  matrix: {
    bodies: BODIES.map(({ key, label }) => ({ key, label })),
    aspects: [{ aKey: 'sun', bKey: 'moon', aspectKey: 'trine', orb: 0.5, applying: true }],
  },
  emphasis: { bodies: BODIES.map(({ body, key, longitude }) => ({ body, key, longitude })) },
  strip: { bodies: BODIES.map(({ key, longitude }) => ({ key, longitude })) },
};

describe('renderChartSheetSvg', () => {
  it('emits exactly one svg element, so every export path takes it whole', () => {
    const { markup } = renderChartSheetSvg(input);
    expect(markup.split('<svg').length - 1).toBe(1);
    expect(markup.split('</svg>').length - 1).toBe(1);
    expect(markup).toContain('class="chart-sheet"');
  });

  it('contains the wheel and all three data panels', () => {
    const { markup } = renderChartSheetSvg(input);
    expect(markup).toContain('wheel-ring-zodiac');
    expect(markup).toContain('chart-house-number');
    expect(markup).toContain('chart-matrix-diagonal');
    expect(markup).toContain('chart-emphasis-cell');
    expect(markup).toContain('chart-strip-axis');
  });

  it('reports the box it drew into, and declares the same one in the markup', () => {
    const { markup, width, height } = renderChartSheetSvg(input);
    expect(width).toBeCloseTo(920, 6); // 800 wheel + 60 margin each side
    expect(markup).toContain(`viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}"`);
    // Taller than wide: three panels stack under a square wheel.
    expect(height).toBeGreaterThan(width);
  });

  it('renders the header lines, titling the first', () => {
    const { markup } = renderChartSheetSvg(input);
    expect(markup).toContain('class="chart-sheet-title"');
    expect(markup.split('class="chart-sheet-meta"').length - 1).toBe(2);
    expect(markup).toContain('>Ada Lovelace<');
  });

  it('escapes header text rather than letting it break the document', () => {
    const { markup } = renderChartSheetSvg({ ...input, metaLines: ['A & B <script>'] });
    expect(markup).toContain('A &amp; B &lt;script&gt;');
    expect(markup).not.toContain('<script>');
  });

  it('omits the header block entirely when there are no header lines', () => {
    const { markup } = renderChartSheetSvg({ ...input, metaLines: [] });
    expect(markup).not.toContain('class="chart-sheet-title"');
    // The emphasis grid's own footer rule is the only one left.
    expect(markup.split('class="chart-panel-rule"').length - 1).toBe(1);
  });

  it('takes its height from the panels, so a taller panel cannot be overlapped', () => {
    // A stellium tall enough to outgrow the square aspect grid beside it — the
    // sheet must follow the taller of the two rather than a fixed row height.
    const stellium = Array.from({ length: 24 }, (_, index) => ({
      body: index as 0,
      key: 'sun',
      longitude: index * 0.5, // all Aries
    }));
    const crowded = renderChartSheetSvg({ ...input, emphasis: { bodies: stellium } });
    expect(crowded.height).toBeGreaterThan(renderChartSheetSvg(input).height);
  });

  it('scales every coordinate with size rather than hardcoding the reference layout', () => {
    const small = renderChartSheetSvg(input, { size: 400 });
    const large = renderChartSheetSvg(input, { size: 1600 });
    expect(large.width / small.width).toBeCloseTo(4, 6);
    expect(large.height / small.height).toBeCloseTo(4, 6);
  });

  it('places the wheel in a translated group so its legend stays inside the sheet', () => {
    const { markup } = renderChartSheetSvg(input);
    const match = /<g transform="translate\((-?[\d.]+) (-?[\d.]+)\)">/.exec(markup);
    expect(match).not.toBeNull();
    // The wheel's own legend draws into a negative margin, so its group must be
    // inset by at least that margin (60 at size 800) to stay on the sheet.
    expect(Number(match?.[1])).toBeGreaterThanOrEqual(60);
  });

  it('draws a bi-wheel with its cross aspects when given two rings', () => {
    const { markup } = renderChartSheetSvg({
      ...input,
      rings: [
        { label: 'Natal', houses: houses(15), bodies: BODIES },
        { label: 'Transits', houses: houses(200), bodies: BODIES },
      ],
      crossAspects: [{ innerRingIndex: 0, outerRingIndex: 1, aspects: [] }],
    });
    expect(markup).toContain('chart-multiwheel-ring-1');
    expect(markup).toContain('chart-multiwheel-legend-label');
    expect(markup).toContain('>Transits<');
  });

  it('rejects a sheet with no wheel ring rather than drawing an empty wheel', () => {
    expect(() => renderChartSheetSvg({ ...input, rings: [] })).toThrow(/at least one ring/);
  });
});
