/**
 * Unit tests for the Jones chart-shape diagram (#401) — pure SVG-string generation, no
 * ephemeris needed, mirroring the fixture style `astrology-jones-shapes.test.ts` already uses.
 */
import { describe, expect, it } from 'vitest';
import { jonesShapeOf } from '../src/astrology/jones-shapes.js';
import { renderJonesShapeDiagramSvg } from '../src/chart/jones-shape-diagram.js';

function positionsOf(longitudes: readonly number[]): Map<number, number> {
  return new Map(longitudes.map((longitude, body) => [body, longitude]));
}

describe('renderJonesShapeDiagramSvg (#401)', () => {
  it('draws one ring and one wedge for a one-group shape (bundle)', () => {
    const positions = positionsOf([10, 30, 50, 70, 90]);
    const result = jonesShapeOf(positions);
    const svg = renderJonesShapeDiagramSvg(result, positions, 140);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('chart-shape-ring');
    expect(svg.split('class="chart-shape-wedge"').length - 1).toBe(1);
    // One dot per body.
    expect(svg.split('class="chart-shape-dot"').length - 1).toBe(5);
  });

  it('draws two wedges for a seesaw, and no handle dot', () => {
    const positions = positionsOf([0, 40, 80, 170, 220, 270]);
    const result = jonesShapeOf(positions);
    const svg = renderJonesShapeDiagramSvg(result, positions, 140);
    expect(svg.split('class="chart-shape-wedge"').length - 1).toBe(2);
    expect(svg).not.toContain('chart-shape-handle');
  });

  it('marks the handle body distinctly for a bucket, with no wedge for its own one-body group', () => {
    const positions = positionsOf([0, 50, 100, 150, 255]);
    const result = jonesShapeOf(positions);
    expect(result.handle).toBe(4);
    const svg = renderJonesShapeDiagramSvg(result, positions, 140);
    // One wedge for the four-body cluster; the handle's own group (length 1) draws no wedge.
    expect(svg.split('class="chart-shape-wedge"').length - 1).toBe(1);
    expect(svg).toContain('chart-shape-dot chart-shape-handle');
    // Every body still gets a dot, handle included — "chart-shape-dot" appears once per dot
    // regardless of whether it's combined with "chart-shape-handle" in that dot's own class.
    expect(svg.split('chart-shape-dot').length - 1).toBe(5);
  });

  it('draws three or more wedges for a splay', () => {
    const positions = positionsOf([0, 10, 20, 130, 140, 250, 260, 270]);
    const result = jonesShapeOf(positions);
    const svg = renderJonesShapeDiagramSvg(result, positions, 140);
    expect(svg.split('class="chart-shape-wedge"').length - 1).toBeGreaterThanOrEqual(3);
  });

  it('skips a body missing from the positions map rather than throwing', () => {
    const positions = positionsOf([10, 30, 50]);
    const result = jonesShapeOf(positions);
    const incomplete = new Map(positions);
    incomplete.delete(2);
    expect(() => renderJonesShapeDiagramSvg(result, incomplete, 140)).not.toThrow();
  });

  it('scales geometry with the requested size', () => {
    const positions = positionsOf([10, 30, 50, 70, 90]);
    const result = jonesShapeOf(positions);
    const small = renderJonesShapeDiagramSvg(result, positions, 100);
    const large = renderJonesShapeDiagramSvg(result, positions, 200);
    expect(small).toContain('viewBox="0 0 100 100"');
    expect(large).toContain('viewBox="0 0 200 200"');
  });
});
