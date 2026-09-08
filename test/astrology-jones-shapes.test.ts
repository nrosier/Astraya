import { describe, expect, it } from 'vitest';
import { jonesShapeOf } from '../src/astrology/jones-shapes.js';

function positionsOf(longitudes: readonly number[]): Map<number, number> {
  return new Map(longitudes.map((longitude, body) => [body, longitude]));
}

describe('jonesShapeOf (#35)', () => {
  it('is a bundle when every body fits within a trine', () => {
    const result = jonesShapeOf(positionsOf([10, 30, 50, 70, 90]));
    expect(result.shape).toBe('bundle');
    expect(result.span).toBeLessThanOrEqual(120);
    expect(result.groups).toEqual([[0, 1, 2, 3, 4]]);
  });

  it('is a bowl when every body fits within a half of the chart', () => {
    const result = jonesShapeOf(positionsOf([0, 40, 80, 120, 160]));
    expect(result.shape).toBe('bowl');
    expect(result.span).toBeGreaterThan(120);
    expect(result.span).toBeLessThanOrEqual(180);
  });

  it('is a locomotive when exactly one trine is empty', () => {
    const result = jonesShapeOf(positionsOf([0, 55, 110, 165, 220]));
    expect(result.shape).toBe('locomotive');
    expect(result.span).toBeGreaterThan(180);
    expect(result.span).toBeLessThanOrEqual(240);
  });

  it('is a bucket when one body is isolated opposite a tight cluster', () => {
    const result = jonesShapeOf(positionsOf([0, 50, 100, 150, 255]));
    expect(result.shape).toBe('bucket');
    expect(result.handle).toBe(4);
    expect(result.groups).toHaveLength(2);
    expect(result.groups.some((group) => group.length === 1)).toBe(true);
  });

  it('is a seesaw when bodies split into two balanced groups', () => {
    const result = jonesShapeOf(positionsOf([0, 40, 80, 170, 220, 270]));
    expect(result.shape).toBe('seesaw');
    expect(result.handle).toBeUndefined();
    expect(result.groups).toHaveLength(2);
    expect(result.groups.every((group) => group.length >= 2)).toBe(true);
  });

  it('is a splay when bodies split into three or more groups', () => {
    const result = jonesShapeOf(positionsOf([0, 10, 20, 130, 140, 250, 260, 270]));
    expect(result.shape).toBe('splay');
    expect(result.groups.length).toBeGreaterThanOrEqual(3);
  });

  it('is a splash when bodies are spread evenly with no significant gap', () => {
    const result = jonesShapeOf(positionsOf([0, 36, 72, 108, 144, 180, 216, 252, 288, 324]));
    expect(result.shape).toBe('splash');
    expect(result.groups).toEqual([Array.from({ length: 10 }, (_, i) => i)]);
  });

  it('rejects fewer than two bodies', () => {
    expect(() => jonesShapeOf(positionsOf([10]))).toThrow(RangeError);
  });
});
