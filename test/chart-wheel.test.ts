/**
 * `wheel.ts` is now geometry only — the coordinate system every chart layer
 * shares. What used to be `renderWheelSvg`'s coverage (ring boundaries, tick
 * tiers, cusp spokes and their angular emphasis, whole-sign snapping,
 * orientation/sweep, size and viewBox) lives in `chart-multi-wheel.test.ts`,
 * against the one renderer that now draws all of it.
 */
import { describe, expect, it } from 'vitest';
import { pointOnCircle, wheelAngle } from '../src/chart/wheel.js';

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
