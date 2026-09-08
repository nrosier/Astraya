import { describe, expect, it } from 'vitest';
import type { Aspect } from '../src/astrology/aspects.js';
import { aspectByKey } from '../src/astrology/aspects.js';
import { pointOnCircle, wheelAngle } from '../src/chart/wheel.js';
import { filterAspectsForDisplay, renderAspectWebSvg } from '../src/chart/aspect-web.js';

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
    expect(svg.split('<line').length - 1).toBe(1);

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
});
