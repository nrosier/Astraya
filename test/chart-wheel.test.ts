import { describe, expect, it } from 'vitest';
import type { HousePositions } from '../src/ephemeris/types.js';
import { pointOnCircle, renderWheelSvg, wheelAngle } from '../src/chart/wheel.js';

function countClass(svg: string, className: string): number {
  return svg.split(`class="${className}"`).length - 1;
}

describe('wheelAngle (#39)', () => {
  it("places the ascendant at 180 (9 o'clock)", () => {
    expect(wheelAngle(123, 123)).toBe(180);
  });

  it('sweeps counterclockwise (increasing) as longitude increases past the ascendant', () => {
    expect(wheelAngle(123 + 90, 123)).toBe(270);
    expect(wheelAngle(123 + 180, 123)).toBe(0);
    expect(wheelAngle(123 + 270, 123)).toBe(90);
  });

  it('wraps into [0, 360)', () => {
    // -10 degrees is the same longitude as 350 (both ≡ 350 mod 360), which
    // equals the ascendant here, so the result is 180 (at the ascendant),
    // not 0.
    expect(wheelAngle(-10, 350)).toBeCloseTo(180, 9);
  });
});

describe('pointOnCircle (#39)', () => {
  it("places 0 degrees at 3 o'clock and sweeps counterclockwise on screen", () => {
    const east = pointOnCircle(0, 0, 10, 0);
    expect(east.x).toBeCloseTo(10, 9);
    expect(east.y).toBeCloseTo(0, 9);
    const north = pointOnCircle(0, 0, 10, 90);
    expect(north.x).toBeCloseTo(0, 9);
    expect(north.y).toBeCloseTo(-10, 9); // up, since SVG y grows downward
    const west = pointOnCircle(0, 0, 10, 180);
    expect(west.x).toBeCloseTo(-10, 9);
    expect(west.y).toBeCloseTo(0, 9);
    const south = pointOnCircle(0, 0, 10, 270);
    expect(south.x).toBeCloseTo(0, 9);
    expect(south.y).toBeCloseTo(10, 9);
  });
});

/**
 * Ascendant at 0 Aries, angles 90 degrees apart at nice round values — chosen
 * so cusp labels are predictable without depending on real house-system math
 * (that is covered by the ephemeris and astrology-houses test suites already;
 * this module only ever reads `ascendant` and `cusps`).
 */
const EQUAL_HOUSES_FIXTURE: HousePositions = {
  cusps: [0, 0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330],
  ascendant: 0,
  midheaven: 270,
  armc: 0,
  vertex: 0,
  equatorialAscendant: 0,
  coAscendantKoch: 0,
  coAscendantMunkasey: 0,
  polarAscendant: 0,
  system: 'A',
};

describe('renderWheelSvg (#39)', () => {
  it('draws the outer and inner ring boundaries', () => {
    const svg = renderWheelSvg(EQUAL_HOUSES_FIXTURE);
    expect(svg).toContain('class="wheel-ring-outer"');
    expect(svg).toContain('class="wheel-ring-inner"');
  });

  it('draws exactly 12 sign-boundary lines and 12 house-cusp spokes, 4 of them angular', () => {
    const svg = renderWheelSvg(EQUAL_HOUSES_FIXTURE);
    expect(countClass(svg, 'wheel-sign-boundary')).toBe(12);
    expect(countClass(svg, 'wheel-cusp-angle')).toBe(4);
    expect(countClass(svg, 'wheel-cusp')).toBe(8);
  });

  it('draws major and minor degree ticks everywhere except the sign boundaries', () => {
    const svg = renderWheelSvg(EQUAL_HOUSES_FIXTURE);
    // 36 multiples of 10 in [0, 360), 12 of which coincide with a sign boundary.
    expect(countClass(svg, 'wheel-tick-major')).toBe(36 - 12);
    // 360 one-degree steps, minus the 12 sign boundaries and 24 major ticks.
    expect(countClass(svg, 'wheel-tick-minor')).toBe(360 - 12 - (36 - 12));
  });

  it('labels each angular cusp with its round degree-in-sign', () => {
    const svg = renderWheelSvg(EQUAL_HOUSES_FIXTURE);
    expect(svg).toContain(">0°0' Aries<");
    expect(svg).toContain(">0°0' Cancer<");
    expect(svg).toContain(">0°0' Libra<");
    expect(svg).toContain(">0°0' Capricorn<");
  });

  it('produces well-formed, self-closing SVG markup', () => {
    const svg = renderWheelSvg(EQUAL_HOUSES_FIXTURE);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('respects a custom size for the width/height, while the viewBox extends beyond it for labels', () => {
    const svg = renderWheelSvg(EQUAL_HOUSES_FIXTURE, { size: 800 });
    expect(svg).toContain('width="800" height="800"');
    // labelMargin defaults to size * 0.16 = 128, so the viewBox spans
    // [-128, 928] on each axis (800 + 2*128 = 1056).
    expect(svg).toContain('viewBox="-128.00 -128.00 1056.00 1056.00"');
  });

  it("keeps every cusp label's anchor point inside the viewBox (#39 regression: labels near the ascendant/descendant were clipped by a viewBox that stopped at the wheel's own edge)", () => {
    const svg = renderWheelSvg(EQUAL_HOUSES_FIXTURE, { size: 500, labelMargin: 40 });
    const viewBoxMatch = /viewBox="(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg);
    if (!viewBoxMatch) throw new Error('no viewBox found');
    const [, minXStr, minYStr, widthStr, heightStr] = viewBoxMatch;
    const minX = Number(minXStr);
    const minY = Number(minYStr);
    const maxX = minX + Number(widthStr);
    const maxY = minY + Number(heightStr);

    const labelPoints = [...svg.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)"/g)];
    expect(labelPoints.length).toBeGreaterThan(0);
    for (const [, xStr, yStr] of labelPoints) {
      const x = Number(xStr);
      const y = Number(yStr);
      expect(x).toBeGreaterThanOrEqual(minX);
      expect(x).toBeLessThanOrEqual(maxX);
      expect(y).toBeGreaterThanOrEqual(minY);
      expect(y).toBeLessThanOrEqual(maxY);
    }
  });
});
