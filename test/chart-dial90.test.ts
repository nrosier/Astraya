import { describe, expect, it } from 'vitest';
import type { MidpointTreeHit } from '../src/astrology/midpoints.js';
import { pointOnCircle } from '../src/chart/wheel.js';
import {
  dialArmLongitudes,
  renderDial90BodiesSvg,
  renderDial90MidpointHitsSvg,
  renderDial90RingSvg,
} from '../src/chart/dial90.js';

function countClass(svg: string, className: string): number {
  return svg.split(`class="${className}"`).length - 1;
}

/** The screen angle this module's own anchor puts a synthetic longitude at: 0 at 12 o'clock, sweeping counterclockwise. */
function dialAngle(syntheticLongitude: number): number {
  const value = (90 + syntheticLongitude) % 360;
  return value < 0 ? value + 360 : value;
}

describe('dialArmLongitudes (#30, #148)', () => {
  it('returns the four 90-degree-apart arms for a longitude already in [0, 90)', () => {
    expect(dialArmLongitudes(37)).toEqual([37, 127, 217, 307]);
  });

  it('gives the same four arms for longitudes that share a dial position', () => {
    // 37, 127, 217 and 307 all reduce to dial position 37 and so share one arm set.
    expect(dialArmLongitudes(127)).toEqual(dialArmLongitudes(37));
    expect(dialArmLongitudes(217)).toEqual(dialArmLongitudes(37));
    expect(dialArmLongitudes(307)).toEqual(dialArmLongitudes(37));
  });
});

describe('renderDial90RingSvg (#148)', () => {
  it('draws the outer and inner ring boundaries', () => {
    const svg = renderDial90RingSvg();
    expect(svg).toContain('class="dial90-ring-outer"');
    expect(svg).toContain('class="dial90-ring-inner"');
  });

  it('draws exactly 4 quadrant boundaries and repeats the major/minor tick scale in each', () => {
    const svg = renderDial90RingSvg();
    expect(countClass(svg, 'dial90-quadrant-boundary')).toBe(4);
    // Per quadrant: 90 one-degree steps, minus the boundary at 0, of which
    // multiples of 10 (10..80) are major: 8 major, 81 minor. Times 4 quadrants.
    expect(countClass(svg, 'dial90-tick-major')).toBe(8 * 4);
    expect(countClass(svg, 'dial90-tick-minor')).toBe(81 * 4);
  });

  it('labels each major tick with its dial degree, repeated once per quadrant', () => {
    const svg = renderDial90RingSvg();
    expect(svg.split('>10°<').length - 1).toBe(4);
    expect(svg.split('>80°<').length - 1).toBe(4);
  });

  it('produces well-formed, self-closing SVG markup', () => {
    const svg = renderDial90RingSvg();
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });
});

describe('renderDial90BodiesSvg (#148)', () => {
  it("places a body's glyph at all four of its dial arms", () => {
    const svg = renderDial90BodiesSvg([{ key: 'sun', longitude: 10 }], 300, 300, 250, 280);
    expect(countClass(svg, 'chart-glyph chart-glyph-sun')).toBe(4);
    // The four arms (10, 100, 190, 280) are each 90 degrees apart, well past
    // the default 6-degree minimum separation, so nothing should be spread.
    expect(svg).not.toContain('chart-glyph-leader');
  });

  it('places one of the four arms at the coordinates the ring itself uses for that dial degree', () => {
    const svg = renderDial90BodiesSvg([{ key: 'sun', longitude: 10 }], 300, 300, 250, 280);
    const point = pointOnCircle(300, 300, 250, dialAngle(10));
    // renderGlyph centers a `size`-pixel box, so its translate is offset by size/2 (12 for the default 24px glyph).
    expect(svg).toContain(`translate(${(point.x - 12).toFixed(2)} ${(point.y - 12).toFixed(2)})`);
  });

  it('renders nothing for no positions', () => {
    expect(renderDial90BodiesSvg([], 300, 300, 250, 280)).toBe('');
  });
});

describe('renderDial90MidpointHitsSvg (#148)', () => {
  const keys: ReadonlyMap<number, string> = new Map([
    [1, 'sun'],
    [2, 'moon'],
    [3, 'mars'],
  ]);
  const keyOf = (body: number): string => {
    const key = keys.get(body);
    if (key === undefined) throw new Error(`test fixture bug: no key for body ${body}`);
    return key;
  };

  it('marks all four dial arms of the pair midpoint, labelled with all three bodies', () => {
    const hits: readonly MidpointTreeHit[] = [{ a: 1, b: 2, midpoint: 37, body: 3, orb: 0.2 }];
    const svg = renderDial90MidpointHitsSvg(hits, keyOf, 300, 300, 200);
    expect(countClass(svg, 'dial90-midpoint-hit')).toBe(4);
    expect(svg.split('>mars=sun/moon<').length - 1).toBe(4);

    const point = pointOnCircle(300, 300, 200, dialAngle(37));
    expect(svg).toContain(`cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}"`);
  });

  it('renders nothing for no hits', () => {
    expect(renderDial90MidpointHitsSvg([], keyOf, 300, 300, 200)).toBe('');
  });
});
