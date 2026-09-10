/**
 * The one wheel renderer, covering both cases: a single natal ring (which is
 * where the zodiac sign glyphs, three tick tiers, house numbers and degree
 * annotations matter) and the 2-3 ring bi-/tri-wheel. The single-ring
 * assertions here absorbed what `renderWheelSvg` used to be tested for.
 */
import { describe, expect, it } from 'vitest';
import type { Aspect } from '../src/astrology/aspects.js';
import { aspectByKey } from '../src/astrology/aspects.js';
import type { HousePositions } from '../src/ephemeris/types.js';
import type { CrossRingAspects, WheelRingInput } from '../src/chart/multi-wheel.js';
import { renderMultiWheelSvg } from '../src/chart/multi-wheel.js';
import { resolveRingBands, resolveSheetGeometry } from '../src/chart/sheet-geometry.js';

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

/** Cusps deliberately off sign boundaries, so 'whole-sign' snapping is visible. */
const UNEQUAL_HOUSES: HousePositions = {
  ...NATAL_HOUSES,
  cusps: [0, 17, 40, 80, 100, 140, 170, 197, 220, 260, 280, 320, 350],
  ascendant: 17,
  midheaven: 100,
  system: 'P',
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

  it('draws exactly one shared zodiac ring regardless of ring count', () => {
    const bi = renderMultiWheelSvg([natalRing, transitRing]);
    const tri = renderMultiWheelSvg([natalRing, transitRing, thirdRing]);
    for (const svg of [bi, tri]) {
      expect(countClass(svg, 'wheel-ring-outer')).toBe(1);
      expect(countClass(svg, 'wheel-ring-zodiac')).toBe(1);
      expect(countClass(svg, 'wheel-ring-inner')).toBe(1);
      expect(countClass(svg, 'wheel-ring-aspect')).toBe(1);
      expect(countClass(svg, 'wheel-sign-boundary')).toBe(12);
    }
  });

  it('gives each non-base ring its own band, leaving the base ring the full-length cusp spokes', () => {
    const bi = renderMultiWheelSvg([natalRing, transitRing]);
    const tri = renderMultiWheelSvg([natalRing, transitRing, thirdRing]);
    expect(bi).toContain('chart-multiwheel-ring-1');
    expect(bi).not.toContain('chart-multiwheel-ring-2');
    expect(tri).toContain('chart-multiwheel-ring-1');
    expect(tri).toContain('chart-multiwheel-ring-2');
    // The base ring's cusps are drawn by the shared house layer, not as a band.
    expect(bi).not.toContain('chart-multiwheel-ring-0 ');
  });

  it('emphasises the four angular cusps in every ring', () => {
    const bi = renderMultiWheelSvg([natalRing, transitRing]);
    const tri = renderMultiWheelSvg([natalRing, transitRing, thirdRing]);
    expect(bi.split('chart-multiwheel-cusp-angle').length - 1).toBe(2 * 4);
    expect(tri.split('chart-multiwheel-cusp-angle').length - 1).toBe(3 * 4);
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

  it("draws a ring's own aspect web when it carries an `aspects` list", () => {
    const natalWithAspects: WheelRingInput = { ...natalRing, aspects: [aspect('square', 1, 2, 0.5)] };
    const svg = renderMultiWheelSvg([natalWithAspects, transitRing]);
    expect(svg).toContain('chart-aspect chart-aspect-square chart-aspect-applying');
    expect(svg).not.toContain('chart-cross-aspect');
  });

  it('omits the aspect web for a ring with no `aspects` field, without affecting other rings', () => {
    const svg = renderMultiWheelSvg([natalRing, { ...transitRing, aspects: [aspect('trine', 1, 3, 0.2)] }]);
    expect(svg).toContain('chart-aspect-trine');
    expect(svg.match(/class="chart-aspect /g)).toHaveLength(1);
  });

  it('excludes conjunctions from the chord web, since two glyphs at one degree already show it', () => {
    const withConjunction: WheelRingInput = {
      ...natalRing,
      aspects: [aspect('conjunction', 1, 2, 0.4), aspect('square', 1, 2, 0.5)],
    };
    const svg = renderMultiWheelSvg([withConjunction]);
    expect(svg).not.toContain('chart-aspect-conjunction');
    expect(svg).toContain('chart-aspect-square');
  });

  it("throws when one of a ring's own aspects references a body not present in that ring", () => {
    const natalWithBadAspect: WheelRingInput = { ...natalRing, aspects: [aspect('square', 1, 999, 0.5)] };
    expect(() => renderMultiWheelSvg([natalWithBadAspect, transitRing])).toThrow(/not present in ring 0/);
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

  it('omits the outer border, zodiac ring and legend in `bare` mode, for embedding in a sheet', () => {
    const bare = renderMultiWheelSvg([natalRing, transitRing], [], { bare: true });
    expect(bare.startsWith('<svg')).toBe(false);
    expect(bare).not.toContain('</svg>');
    expect(bare).toContain('wheel-sign-boundary');
  });
});

describe('renderMultiWheelSvg zodiac ring', () => {
  it('draws all twelve zodiac sign glyphs, which the wheel previously lacked entirely', () => {
    const svg = renderMultiWheelSvg([natalRing]);
    expect(countClass(svg, 'chart-sign-glyph chart-sign-glyph-aries')).toBe(1);
    expect(countClass(svg, 'chart-sign-glyph chart-sign-glyph-pisces')).toBe(1);
    expect(svg.split('chart-sign-glyph chart-sign-glyph-').length - 1).toBe(12);
  });

  it('draws three tick tiers, none of them landing on a sign boundary', () => {
    const svg = renderMultiWheelSvg([natalRing]);
    // 12 sign boundaries replace the tick at every multiple of 30.
    expect(countClass(svg, 'wheel-tick-major')).toBe(36 - 12); // multiples of 10
    expect(countClass(svg, 'wheel-tick-medium')).toBe(72 - 36); // multiples of 5 only
    expect(countClass(svg, 'wheel-tick-minor')).toBe(360 - 12 - 24 - 36);
  });

  it('gives the three tiers distinct lengths, all standing on the zodiac ring inner edge', () => {
    const geometry = resolveSheetGeometry(800);
    expect(geometry.tickMinorLength).toBeLessThan(geometry.tickMediumLength);
    expect(geometry.tickMediumLength).toBeLessThan(geometry.tickMajorLength);
    expect(geometry.zodiacInner + geometry.tickMajorLength).toBeLessThan(geometry.zodiacOuter);
  });
});

describe('renderMultiWheelSvg house structure', () => {
  it('numbers all twelve houses', () => {
    const svg = renderMultiWheelSvg([natalRing]);
    expect(countClass(svg, 'chart-house-number')).toBe(12);
    for (const house of [1, 5, 12]) {
      expect(svg).toContain(`>${String(house)}<`);
    }
  });

  it('draws the horizon and meridian as two heavy axes across the whole chart', () => {
    const svg = renderMultiWheelSvg([natalRing]);
    expect(countClass(svg, 'chart-multiwheel-axis')).toBe(2);
  });

  it("draws the axes from the true angles, so 'whole-sign' cusp snapping cannot move the horizon", () => {
    const ring: WheelRingInput = { ...natalRing, houses: UNEQUAL_HOUSES };
    const equalDegree = renderMultiWheelSvg([ring]);
    const wholeSign = renderMultiWheelSvg([ring], [], { houseWedgeStyle: 'whole-sign' });
    const axisOf = (svg: string): string[] =>
      [...svg.matchAll(/<line [^>]*class="chart-multiwheel-axis" \/>/g)].map((m) => m[0]);
    expect(axisOf(equalDegree)).toEqual(axisOf(wholeSign));
    // The spokes themselves do move, so this is not a no-op comparison.
    expect(wholeSign).not.toBe(equalDegree);
  });

  it("'whole-sign' snaps cusp spokes to sign boundaries without touching the zodiac ring", () => {
    const ring: WheelRingInput = { ...natalRing, houses: UNEQUAL_HOUSES };
    const equalDegree = renderMultiWheelSvg([ring]);
    const wholeSign = renderMultiWheelSvg([ring], [], { houseWedgeStyle: 'whole-sign' });
    for (const className of ['wheel-sign-boundary', 'wheel-tick-major', 'wheel-tick-medium', 'wheel-tick-minor']) {
      expect(countClass(equalDegree, className)).toBe(countClass(wholeSign, className));
    }
  });
});

describe('renderMultiWheelSvg degree annotations', () => {
  it('labels each body with its degree and minute within its sign, zero-padded', () => {
    const ring: WheelRingInput = {
      ...natalRing,
      bodies: [
        { body: 1, key: 'sun', longitude: 10.2 }, // 10°12' Aries
        { body: 2, key: 'moon', longitude: 185.5 }, // 05°30' Libra
      ],
    };
    const svg = renderMultiWheelSvg([ring]);
    expect(svg).toContain(">10°12'<");
    expect(svg).toContain(">05°30'<");
    expect(countClass(svg, 'chart-degree-label')).toBe(2);
  });

  it('annotates at the spread angle, so a nudged glyph keeps its label beside it', () => {
    const crowded: WheelRingInput = {
      ...natalRing,
      bodies: [
        { body: 1, key: 'sun', longitude: 10 },
        { body: 2, key: 'moon', longitude: 11 },
      ],
    };
    const labelPoint = (svg: string): readonly [number, number] => {
      const match = /<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*class="chart-degree-label"/.exec(svg);
      if (!match) throw new Error('expected a degree label');
      return [Number(match[1]), Number(match[2])];
    };
    const alone = renderMultiWheelSvg([{ ...natalRing, bodies: [{ body: 1, key: 'sun', longitude: 10 }] }]);
    const [aloneX, aloneY] = labelPoint(alone);
    const [movedX, movedY] = labelPoint(renderMultiWheelSvg([crowded]));
    // The 6° minimum separation nudges the Sun 2.5° back off its true 10°, and
    // its label has to travel with the glyph rather than stay at the true
    // degree: 2.5° at the label radius is around 9px.
    expect(Math.hypot(movedX - aloneX, movedY - aloneY)).toBeGreaterThan(8);
    // The text still reports the true degree: only the position is nudged.
    expect(renderMultiWheelSvg([crowded])).toContain(">10°00'<");
  });

  it('drops the labels a cluster has no room for rather than overlapping them', () => {
    const cluster: WheelRingInput = {
      ...natalRing,
      bodies: [
        { body: 1, key: 'sun', longitude: 10 },
        { body: 2, key: 'moon', longitude: 11 },
        { body: 3, key: 'mercury', longitude: 12 },
        { body: 4, key: 'venus', longitude: 200 },
      ],
    };
    const svg = renderMultiWheelSvg([cluster]);
    // A label is several times wider than the glyph it annotates, so three
    // bodies inside 2° cannot all carry one; the isolated Venus always can.
    const labels = svg.split('class="chart-degree-label"').length - 1;
    expect(labels).toBeGreaterThanOrEqual(2);
    expect(labels).toBeLessThan(4);
  });

  it('keeps a label for every body once they are spread far enough apart', () => {
    const spread: WheelRingInput = {
      ...natalRing,
      bodies: [
        { body: 1, key: 'sun', longitude: 10 },
        { body: 2, key: 'moon', longitude: 100 },
        { body: 3, key: 'mercury', longitude: 190 },
        { body: 4, key: 'venus', longitude: 280 },
      ],
    };
    expect(renderMultiWheelSvg([spread]).split('class="chart-degree-label"').length - 1).toBe(4);
  });

  it('shows the same labels at every size, since the threshold is an angle not a pixel count', () => {
    const cluster: WheelRingInput = {
      ...natalRing,
      bodies: [
        { body: 1, key: 'sun', longitude: 10 },
        { body: 2, key: 'moon', longitude: 14 },
        { body: 3, key: 'mercury', longitude: 18 },
      ],
    };
    const count = (size: number): number =>
      renderMultiWheelSvg([cluster], [], { size }).split('class="chart-degree-label"').length - 1;
    expect(count(1600)).toBe(count(400));
  });

  it('omits degree labels once rings are stacked, where the bands are too narrow for them', () => {
    expect(renderMultiWheelSvg([natalRing, transitRing])).not.toContain('chart-degree-label');
  });
});

describe('renderMultiWheelSvg scaling', () => {
  it('scales every drawn radius with `size` rather than hardcoding the reference layout', () => {
    const small = renderMultiWheelSvg([natalRing], [], { size: 400 });
    const large = renderMultiWheelSvg([natalRing], [], { size: 1600 });
    // Only the layout's own circles — a body glyph's internal artwork is drawn
    // in its own 0-100 box and scaled by a transform, so its literal radii are
    // deliberately size-independent.
    const radiiOf = (svg: string): number[] =>
      [...svg.matchAll(/<circle [^>]*r="([\d.]+)" class="(?:wheel-ring|chart-multiwheel-ring)[^"]*"/g)].map((m) =>
        Number(m[1]),
      );
    const smallRadii = radiiOf(small);
    const largeRadii = radiiOf(large);
    expect(smallRadii.length).toBeGreaterThan(0);
    expect(largeRadii).toHaveLength(smallRadii.length);
    smallRadii.forEach((radius, index) => {
      expect(largeRadii[index]).toBeCloseTo(radius * 4, 1);
    });
  });

  it('reports the requested size on the element while the viewBox reserves the label margin', () => {
    const svg = renderMultiWheelSvg([natalRing], [], { size: 800 });
    expect(svg).toContain('width="800" height="800"');
    // labelMargin is 60 at the reference size, so the viewBox spans [-60, 860].
    expect(svg).toContain('viewBox="-60.00 -60.00 920.00 920.00"');
  });

  it('keeps every glyph and label clear of the aspect disk, at any ring count', () => {
    const geometry = resolveSheetGeometry(800);
    for (const rings of [[natalRing], [natalRing, transitRing], [natalRing, transitRing, thirdRing]]) {
      const bands = resolveRingBands(geometry, rings.length);
      for (const band of bands) {
        expect(band.innerRadius).toBeGreaterThanOrEqual(geometry.aspectCircle);
      }
      const svg = renderMultiWheelSvg(rings, [], { size: 800 });
      const glyphPoints = [...svg.matchAll(/translate\((-?[\d.]+) (-?[\d.]+)\)/g)];
      expect(glyphPoints.length).toBeGreaterThan(0);
    }
  });
});
