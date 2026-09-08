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

  it("orientation 'aries-up' fixes 0 Aries at 90 (12 o'clock), ignoring the ascendant (#43)", () => {
    expect(wheelAngle(0, 123, { orientation: 'aries-up' })).toBe(90);
    expect(wheelAngle(90, 123, { orientation: 'aries-up' })).toBeCloseTo(180, 9);
    expect(wheelAngle(0, 999, { orientation: 'aries-up' })).toBe(wheelAngle(0, -47, { orientation: 'aries-up' }));
  });

  it("sweep 'clockwise' reverses which way longitude moves around the wheel (#43)", () => {
    expect(wheelAngle(123, 123, { sweep: 'clockwise' })).toBe(180);
    expect(wheelAngle(123 + 90, 123, { sweep: 'clockwise' })).toBe(90);
    expect(wheelAngle(123 + 270, 123, { sweep: 'clockwise' })).toBe(270);
  });

  it('defaults reproduce the un-optioned result exactly (#43 backward compatibility)', () => {
    expect(wheelAngle(200, 40, { orientation: 'asc-left', sweep: 'counterclockwise' })).toBe(wheelAngle(200, 40));
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

/** Cusps deliberately off sign boundaries, so 'whole-sign' snapping is visible. */
const UNEQUAL_HOUSES_FIXTURE: HousePositions = {
  cusps: [0, 17, 40, 80, 100, 140, 170, 197, 220, 260, 280, 320, 350],
  ascendant: 17,
  midheaven: 100,
  armc: 0,
  vertex: 0,
  equatorialAscendant: 0,
  coAscendantKoch: 0,
  coAscendantMunkasey: 0,
  polarAscendant: 0,
  system: 'P',
};

describe('renderWheelSvg houseWedgeStyle (#43)', () => {
  it("'equal-degree' (the default) draws each cusp at its literal computed degree", () => {
    const svg = renderWheelSvg(UNEQUAL_HOUSES_FIXTURE);
    expect(svg).toContain(">17°0' Aries<"); // house 1 (the ascendant itself)
    expect(svg).toContain(">10°0' Taurus<"); // house 2, cusp at 40
  });

  it("'whole-sign' snaps every cusp spoke and label to the boundary of the sign it falls in", () => {
    const svg = renderWheelSvg(UNEQUAL_HOUSES_FIXTURE, { houseWedgeStyle: 'whole-sign' });
    expect(svg).toContain(">0°0' Aries<"); // house 1: 17 Aries snaps down to 0 Aries
    expect(svg).toContain(">0°0' Taurus<"); // house 2: 40 (10 Taurus) snaps down to 0 Taurus
    expect(svg).not.toContain(">17°0' Aries<");
    expect(svg).not.toContain(">10°0' Taurus<");
  });

  it('does not affect the zodiac ring ticks, only the house-cusp spokes and labels', () => {
    const equalDegree = renderWheelSvg(UNEQUAL_HOUSES_FIXTURE);
    const wholeSign = renderWheelSvg(UNEQUAL_HOUSES_FIXTURE, { houseWedgeStyle: 'whole-sign' });
    expect(countClass(equalDegree, 'wheel-sign-boundary')).toBe(countClass(wholeSign, 'wheel-sign-boundary'));
    expect(countClass(equalDegree, 'wheel-tick-major')).toBe(countClass(wholeSign, 'wheel-tick-major'));
    expect(countClass(equalDegree, 'wheel-tick-minor')).toBe(countClass(wholeSign, 'wheel-tick-minor'));
  });
});

describe('renderWheelSvg orientation and sweep (#43)', () => {
  it("orientation 'aries-up' keeps the wheel's rings fixed to the zodiac rather than the ascendant", () => {
    const ascLeft = renderWheelSvg(EQUAL_HOUSES_FIXTURE, { orientation: 'asc-left' });
    const ariesUp = renderWheelSvg(EQUAL_HOUSES_FIXTURE, { orientation: 'aries-up' });
    // Same fixture, different orientation: the two renders must differ.
    expect(ariesUp).not.toBe(ascLeft);
    // Both still well-formed.
    expect(ariesUp.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
  });

  it("sweep 'clockwise' changes the drawn geometry relative to the default counterclockwise sweep", () => {
    const counterclockwise = renderWheelSvg(EQUAL_HOUSES_FIXTURE);
    const clockwise = renderWheelSvg(EQUAL_HOUSES_FIXTURE, { sweep: 'clockwise' });
    expect(clockwise).not.toBe(counterclockwise);
  });
});
