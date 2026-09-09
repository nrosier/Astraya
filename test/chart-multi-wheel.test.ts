import { describe, expect, it } from 'vitest';
import type { Aspect } from '../src/astrology/aspects.js';
import { aspectByKey } from '../src/astrology/aspects.js';
import type { HousePositions } from '../src/ephemeris/types.js';
import type { CrossRingAspects, WheelRingInput } from '../src/chart/multi-wheel.js';
import { renderMultiWheelSvg } from '../src/chart/multi-wheel.js';

function countClass(svg: string, className: string): number {
  return svg.split(`class="${className}"`).length - 1;
}

function aspect(key: string, bodyA: number, bodyB: number, orb: number, applying = true): Aspect {
  const definition = aspectByKey(key);
  if (!definition) throw new Error(`test fixture bug: unknown aspect key "${key}"`);
  return { aspect: definition, bodyA, bodyB, separation: definition.angle + orb, orb, applying };
}

const NATAL_HOUSES: HousePositions = {
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

const TRANSIT_HOUSES: HousePositions = {
  ...NATAL_HOUSES,
  cusps: [0, 50, 80, 110, 140, 170, 200, 230, 260, 290, 320, 350, 20],
  ascendant: 50,
  midheaven: 320,
};

const THIRD_HOUSES: HousePositions = {
  ...NATAL_HOUSES,
  cusps: [0, 95, 125, 155, 185, 215, 245, 275, 305, 335, 5, 35, 65],
  ascendant: 95,
  midheaven: 5,
};

const natalRing: WheelRingInput = {
  label: 'Natal',
  houses: NATAL_HOUSES,
  bodies: [
    { body: 1, key: 'sun', longitude: 10 },
    { body: 2, key: 'moon', longitude: 190 },
  ],
};

const transitRing: WheelRingInput = {
  label: 'Transiting',
  houses: TRANSIT_HOUSES,
  bodies: [
    { body: 1, key: 'sun', longitude: 100 },
    { body: 3, key: 'mars', longitude: 280 },
  ],
};

const thirdRing: WheelRingInput = {
  label: 'Progressed',
  houses: THIRD_HOUSES,
  bodies: [{ body: 4, key: 'venus', longitude: 200 }],
};

describe('renderMultiWheelSvg (#52)', () => {
  it('throws for an empty ring list', () => {
    expect(() => renderMultiWheelSvg([])).toThrow(/at least one ring/);
  });

  it('produces well-formed, self-closing SVG markup', () => {
    const svg = renderMultiWheelSvg([natalRing, transitRing]);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('draws exactly one shared outer zodiac ring regardless of ring count', () => {
    const bi = renderMultiWheelSvg([natalRing, transitRing]);
    const tri = renderMultiWheelSvg([natalRing, transitRing, thirdRing]);
    expect(countClass(bi, 'wheel-ring-outer')).toBe(1);
    expect(countClass(bi, 'wheel-sign-boundary')).toBe(12);
    expect(countClass(tri, 'wheel-ring-outer')).toBe(1);
    expect(countClass(tri, 'wheel-sign-boundary')).toBe(12);
  });

  it('draws one per-ring cusp boundary and 12 cusp spokes for each ring (bi-wheel)', () => {
    const svg = renderMultiWheelSvg([natalRing, transitRing]);
    expect(svg.split('chart-multiwheel-ring-0').length - 1).toBeGreaterThan(0);
    expect(svg.split('chart-multiwheel-ring-1').length - 1).toBeGreaterThan(0);
    // 4 angular + 8 non-angular cusp spokes per ring, plus one boundary circle per ring.
    expect(svg.split('chart-multiwheel-cusp-angle').length - 1).toBe(2 * 4);
  });

  it('adds a third ring band for a tri-wheel without touching the other two', () => {
    const svg = renderMultiWheelSvg([natalRing, transitRing, thirdRing]);
    expect(svg.split('chart-multiwheel-ring-0').length - 1).toBeGreaterThan(0);
    expect(svg.split('chart-multiwheel-ring-1').length - 1).toBeGreaterThan(0);
    expect(svg.split('chart-multiwheel-ring-2').length - 1).toBeGreaterThan(0);
  });

  it('draws each ring label in a fixed corner legend, not rotating with the wheel', () => {
    const svg = renderMultiWheelSvg([natalRing, transitRing, thirdRing]);
    expect(svg).toContain('>Natal<');
    expect(svg).toContain('>Transiting<');
    expect(svg).toContain('>Progressed<');
    expect(countClass(svg, 'chart-multiwheel-legend-label')).toBe(3);
  });

  it('escapes special characters in a ring label', () => {
    const svg = renderMultiWheelSvg([{ ...natalRing, label: 'A & B <C>' }, transitRing]);
    expect(svg).toContain('A &amp; B &lt;C&gt;');
  });

  it("reuses collision spreading per ring: crowded bodies in one ring don't affect another ring", () => {
    const crowdedNatal: WheelRingInput = {
      ...natalRing,
      bodies: [
        { body: 1, key: 'sun', longitude: 10 },
        { body: 2, key: 'moon', longitude: 11 },
      ],
    };
    const svg = renderMultiWheelSvg([crowdedNatal, transitRing]);
    // Leader lines are only drawn for glyphs that were actually moved apart.
    expect(countClass(svg, 'chart-glyph-leader')).toBe(2);
  });

  it('draws a cross-ring aspect line between bodies on two different rings', () => {
    const crossAspects: readonly CrossRingAspects[] = [
      { innerRingIndex: 0, outerRingIndex: 1, aspects: [aspect('square', 1, 2, 0.5)] },
    ];
    const svg = renderMultiWheelSvg([natalRing, transitRing], crossAspects);
    expect(svg).toContain('chart-aspect chart-cross-aspect chart-aspect-square chart-aspect-applying');
  });

  it('throws when crossAspects references a ring index out of range', () => {
    const crossAspects: readonly CrossRingAspects[] = [
      { innerRingIndex: 0, outerRingIndex: 5, aspects: [aspect('square', 1, 2, 0.5)] },
    ];
    expect(() => renderMultiWheelSvg([natalRing, transitRing], crossAspects)).toThrow(/ring index out of range/);
  });

  it("throws when a cross-ring aspect's body isn't present in the ring it's supposed to resolve from", () => {
    const crossAspects: readonly CrossRingAspects[] = [
      { innerRingIndex: 0, outerRingIndex: 1, aspects: [aspect('square', 1, 999, 0.5)] },
    ];
    expect(() => renderMultiWheelSvg([natalRing, transitRing], crossAspects)).toThrow(/not present in inner ring/);
  });

  it('threads orientation/sweep options through every ring consistently', () => {
    const defaultOrientation = renderMultiWheelSvg([natalRing, transitRing]);
    const ariesUp = renderMultiWheelSvg([natalRing, transitRing], [], { orientation: 'aries-up' });
    const clockwise = renderMultiWheelSvg([natalRing, transitRing], [], { sweep: 'clockwise' });
    expect(ariesUp).not.toBe(defaultOrientation);
    expect(clockwise).not.toBe(defaultOrientation);
  });

  it('respects a custom size for the width/height', () => {
    const svg = renderMultiWheelSvg([natalRing, transitRing], [], { size: 800 });
    expect(svg).toContain('width="800" height="800"');
  });
});
