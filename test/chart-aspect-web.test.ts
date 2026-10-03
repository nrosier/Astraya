import { describe, expect, it } from 'vitest';
import type { Aspect } from '../src/astrology/aspects.js';
import { aspectByKey } from '../src/astrology/aspects.js';
import { pointOnCircle, wheelAngle } from '../src/chart/wheel.js';
import { filterAspectsForDisplay, renderAspectWebSvg, renderCrossRingAspectWebSvg } from '../src/chart/aspect-web.js';

function aspect(key: string, bodyA: number, bodyB: number, orb: number, applying = true): Aspect {
  const definition = aspectByKey(key);
  if (!definition) throw new Error(`test fixture bug: unknown aspect key "${key}"`);
  return { aspect: definition, bodyA, bodyB, separation: definition.angle + orb, orb, applying };
}

describe('filterAspectsForDisplay (#42)', () => {
  const aspects: readonly Aspect[] = [
    aspect('square', 0, 1, 1),
    aspect('trine', 1, 2, 4),
    aspect('quintile', 2, 3, 0.5),
  ];

  it('passes every aspect through with no filter', () => {
    expect(filterAspectsForDisplay(aspects)).toEqual(aspects);
  });

  it('keeps only the listed aspect keys', () => {
    const result = filterAspectsForDisplay(aspects, { visibleAspectKeys: ['square', 'quintile'] });
    expect(result.map((a) => a.aspect.key)).toEqual(['square', 'quintile']);
  });

  it('keeps only the listed aspect families', () => {
    const result = filterAspectsForDisplay(aspects, { visibleFamilies: ['minor'] });
    expect(result.map((a) => a.aspect.key)).toEqual(['quintile']);
  });

  it('drops any aspect wider than the orb-tightness threshold', () => {
    const result = filterAspectsForDisplay(aspects, { maxOrb: 1 });
    expect(result.map((a) => a.aspect.key)).toEqual(['square', 'quintile']);
  });

  it('combines every filter criterion', () => {
    const result = filterAspectsForDisplay(aspects, {
      visibleFamilies: ['major', 'minor'],
      visibleAspectKeys: ['square', 'trine', 'quintile'],
      maxOrb: 2,
    });
    expect(result.map((a) => a.aspect.key)).toEqual(['square', 'quintile']);
  });
});

describe('renderAspectWebSvg (#42)', () => {
  const longitudes = new Map<number, number>([
    [1, 10],
    [2, 100],
  ]);
  const longitudeOf = (body: number): number => {
    const longitude = longitudes.get(body);
    if (longitude === undefined) throw new Error(`test fixture bug: no longitude for body ${body}`);
    return longitude;
  };

  it('draws one line per aspect, chording the requested radius', () => {
    const aspects = [aspect('square', 1, 2, 0.5, true)];
    const svg = renderAspectWebSvg(aspects, longitudeOf, 0, 300, 300, 200);
    expect(svg.split('class="chart-aspect ').length - 1).toBe(1);

    const angleA = wheelAngle(10, 0);
    const angleB = wheelAngle(100, 0);
    const pointA = pointOnCircle(300, 300, 200, angleA);
    const pointB = pointOnCircle(300, 300, 200, angleB);
    expect(svg).toContain(`x1="${pointA.x.toFixed(2)}" y1="${pointA.y.toFixed(2)}"`);
    expect(svg).toContain(`x2="${pointB.x.toFixed(2)}" y2="${pointB.y.toFixed(2)}"`);
  });

  it('styles each line with its aspect key and applying/separating direction', () => {
    const aspects = [aspect('square', 1, 2, 0.5, true), aspect('trine', 1, 2, 1, false)];
    const svg = renderAspectWebSvg(aspects, longitudeOf, 0, 300, 300, 200);
    expect(svg).toContain('chart-aspect chart-aspect-square chart-aspect-applying');
    expect(svg).toContain('chart-aspect chart-aspect-trine chart-aspect-separating');
  });

  it('renders nothing for an empty aspect list', () => {
    expect(renderAspectWebSvg([], longitudeOf, 0, 300, 300, 200)).toBe('');
  });

  it('wraps each chord with a wide invisible hit line carrying the endpoint keys, so a thin line is easy to click (#412)', () => {
    const svg = renderAspectWebSvg([aspect('trine', 1, 2, 3, false)], longitudeOf, 0, 300, 300, 200);
    expect(svg).toMatch(
      /^<g class="chart-aspect-link" data-aspect-key="trine" data-aspect-body-a="[^"]+" data-aspect-body-b="[^"]+" data-ring-a="0" data-ring-b="0">/,
    );
    expect(svg).toContain('class="chart-hit-area" stroke="none" stroke-width="10" pointer-events="all"');
  });

  it('marks an aspect within 1° as tight, and a wider one not (#412)', () => {
    const tight = renderAspectWebSvg([aspect('square', 1, 2, 0.8, true)], longitudeOf, 0, 300, 300, 200);
    const wide = renderAspectWebSvg([aspect('square', 1, 2, 2.5, true)], longitudeOf, 0, 300, 300, 200);
    expect(tight).toContain('chart-aspect-tight');
    expect(wide).not.toContain('chart-aspect-tight');
  });

  it('carries data-aspect-key/data-aspect-body-a/-b for click-to-isolate (#400)', () => {
    const aspects = [aspect('square', 1, 2, 0.5, true)];
    const svg = renderAspectWebSvg(aspects, longitudeOf, 0, 300, 300, 200);
    expect(svg).toContain('data-aspect-key="square"');
    // bodyA=1/bodyB=2 happen to be real Swiss Ephemeris constants (Moon/Mercury) — bodyKeyOf
    // resolves them to their string key, the same one glyph-layout.ts's data-body uses.
    expect(svg).toContain('data-aspect-body-a="moon"');
    expect(svg).toContain('data-aspect-body-b="mercury"');
  });

  it("threads orientation/sweep options through to wheelAngle, matching renderWheelSvg's layer (#43)", () => {
    const aspects = [aspect('square', 1, 2, 0.5, true)];
    const defaultOrientation = renderAspectWebSvg(aspects, longitudeOf, 0, 300, 300, 200);
    const ariesUp = renderAspectWebSvg(aspects, longitudeOf, 0, 300, 300, 200, { orientation: 'aries-up' });
    const clockwise = renderAspectWebSvg(aspects, longitudeOf, 0, 300, 300, 200, { sweep: 'clockwise' });
    expect(ariesUp).not.toBe(defaultOrientation);
    expect(clockwise).not.toBe(defaultOrientation);
  });
});

describe('aspect chords carry the ring of each end (#418)', () => {
  const longitudeOf = (): number => 10;

  it('marks a chart’s own aspects with one ring at both ends, defaulting to the innermost', () => {
    const own = renderAspectWebSvg([aspect('square', 1, 2, 0.5, true)], longitudeOf, 0, 300, 300, 200);
    expect(own).toContain('data-ring-a="0" data-ring-b="0"');
    const onRingOne = renderAspectWebSvg(
      [aspect('square', 1, 2, 0.5, true)],
      longitudeOf,
      0,
      300,
      300,
      200,
      undefined,
      1,
    );
    expect(onRingOne).toContain('data-ring-a="1" data-ring-b="1"');
  });
});

describe('renderCrossRingAspectWebSvg (#52)', () => {
  const resolveA = (body: number): { longitude: number; radius: number; ring: number } => {
    if (body === 1) return { longitude: 10, radius: 250, ring: 1 };
    throw new Error(`test fixture bug: no outer-ring longitude for body ${body}`);
  };
  const resolveB = (body: number): { longitude: number; radius: number; ring: number } => {
    if (body === 2) return { longitude: 100, radius: 100, ring: 0 };
    throw new Error(`test fixture bug: no inner-ring longitude for body ${body}`);
  };

  it('draws one line per aspect, chording each side at its own radius', () => {
    const aspects = [aspect('square', 1, 2, 0.5, true)];
    const svg = renderCrossRingAspectWebSvg(aspects, resolveA, resolveB, 0, 300, 300);
    expect(svg.split('class="chart-aspect ').length - 1).toBe(1);

    const angleA = wheelAngle(10, 0);
    const angleB = wheelAngle(100, 0);
    const pointA = pointOnCircle(300, 300, 250, angleA);
    const pointB = pointOnCircle(300, 300, 100, angleB);
    expect(svg).toContain(`x1="${pointA.x.toFixed(2)}" y1="${pointA.y.toFixed(2)}"`);
    expect(svg).toContain(`x2="${pointB.x.toFixed(2)}" y2="${pointB.y.toFixed(2)}"`);
  });

  it('styles each line with the shared aspect classes plus a cross-ring marker', () => {
    const aspects = [aspect('square', 1, 2, 0.5, true)];
    const svg = renderCrossRingAspectWebSvg(aspects, resolveA, resolveB, 0, 300, 300);
    expect(svg).toContain('chart-aspect chart-cross-aspect chart-aspect-square chart-aspect-applying');
  });

  it('marks each end of a cross-ring chord with its own ring, outer side first (#418)', () => {
    const svg = renderCrossRingAspectWebSvg([aspect('square', 1, 2, 0.5, true)], resolveA, resolveB, 0, 300, 300);
    expect(svg).toContain('data-ring-a="1" data-ring-b="0"');
  });

  it('renders nothing for an empty aspect list', () => {
    expect(renderCrossRingAspectWebSvg([], resolveA, resolveB, 0, 300, 300)).toBe('');
  });

  it('carries data-aspect-key/data-aspect-body-a/-b for click-to-isolate (#400)', () => {
    const aspects = [aspect('square', 1, 2, 0.5, true)];
    const svg = renderCrossRingAspectWebSvg(aspects, resolveA, resolveB, 0, 300, 300);
    expect(svg).toContain('data-aspect-key="square"');
    expect(svg).toContain('data-aspect-body-a="moon"');
    expect(svg).toContain('data-aspect-body-b="mercury"');
  });
});
