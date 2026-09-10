import { describe, expect, it } from 'vitest';
import { resolveRingBands, resolveSheetGeometry } from '../src/chart/sheet-geometry.js';

/** The reference layout is specified at this size, so it is the one size with literal expectations. */
const REFERENCE_SIZE = 800;

describe('resolveSheetGeometry', () => {
  it('reproduces the reference layout exactly at size 800', () => {
    const geometry = resolveSheetGeometry(REFERENCE_SIZE);
    expect(geometry.outerBorder).toBe(380);
    expect(geometry.zodiacOuter).toBe(376);
    expect(geometry.zodiacInner).toBe(320);
    expect(geometry.houseRing).toBe(280);
    expect(geometry.aspectCircle).toBe(190);
    expect(geometry.signGlyphRadius).toBe(348);
  });

  it('puts the reference tick lengths on the three tiers', () => {
    const geometry = resolveSheetGeometry(REFERENCE_SIZE);
    expect(geometry.tickMinorLength).toBe(2);
    expect(geometry.tickMediumLength).toBe(5);
    expect(geometry.tickMajorLength).toBe(8);
  });

  it('centers the chart in its own box', () => {
    const geometry = resolveSheetGeometry(500);
    expect(geometry.cx).toBe(250);
    expect(geometry.cy).toBe(250);
  });

  it('places house numbers between the zodiac ring and the chart rings', () => {
    const geometry = resolveSheetGeometry(REFERENCE_SIZE);
    expect(geometry.houseNumberRadius).toBeGreaterThan(geometry.houseRing);
    expect(geometry.houseNumberRadius).toBeLessThan(geometry.zodiacInner);
  });

  it('keeps every radius in the expected order, at any size', () => {
    for (const size of [200, 600, 800, 2400]) {
      const g = resolveSheetGeometry(size);
      expect(g.aspectCircle).toBeLessThan(g.houseRing);
      expect(g.houseRing).toBeLessThan(g.zodiacInner);
      expect(g.zodiacInner).toBeLessThan(g.signGlyphRadius);
      expect(g.signGlyphRadius).toBeLessThan(g.zodiacOuter);
      expect(g.zodiacOuter).toBeLessThan(g.outerBorder);
      // The outer border has to stay inside the box it is centred in.
      expect(g.outerBorder).toBeLessThan(size / 2);
    }
  });

  // The scaling guarantee: nothing may be a fixed pixel value, or these ratios would drift.
  it('scales every value proportionally rather than hardcoding pixels', () => {
    const small = resolveSheetGeometry(600);
    const large = resolveSheetGeometry(2400);
    const factor = 4;
    for (const key of Object.keys(small) as (keyof typeof small)[]) {
      if (key === 'size') continue;
      expect(large[key]).toBeCloseTo(small[key] * factor, 6);
    }
  });
});

describe('resolveRingBands', () => {
  it('rejects a ring count below one', () => {
    expect(() => resolveRingBands(resolveSheetGeometry(REFERENCE_SIZE), 0)).toThrow(/at least one ring/);
  });

  it('gives a single ring the reference layout planetary radius', () => {
    const [band] = resolveRingBands(resolveSheetGeometry(REFERENCE_SIZE), 1);
    expect(band?.glyphRadius).toBe(235);
  });

  it('spans exactly the aspect circle to the house ring, leaving the aspect disk free', () => {
    const geometry = resolveSheetGeometry(REFERENCE_SIZE);
    const bands = resolveRingBands(geometry, 3);
    expect(bands).toHaveLength(3);
    expect(bands[0]?.innerRadius).toBe(geometry.aspectCircle);
    expect(bands[2]?.outerRadius).toBeCloseTo(geometry.houseRing, 6);
  });

  it('divides the span into equal, non-overlapping bands ordered innermost first', () => {
    const bands = resolveRingBands(resolveSheetGeometry(REFERENCE_SIZE), 3);
    const widths = bands.map((band) => band.outerRadius - band.innerRadius);
    expect(widths[0]).toBeCloseTo(widths[1] ?? 0, 6);
    expect(widths[1]).toBeCloseTo(widths[2] ?? 0, 6);
    expect(bands[0]?.outerRadius).toBeCloseTo(bands[1]?.innerRadius ?? 0, 6);
    expect(bands[1]?.outerRadius).toBeCloseTo(bands[2]?.innerRadius ?? 0, 6);
  });

  it('orders each band leader line inside its glyphs and annotations outside them', () => {
    for (const band of resolveRingBands(resolveSheetGeometry(REFERENCE_SIZE), 2)) {
      expect(band.trueRadius).toBeGreaterThanOrEqual(band.innerRadius);
      expect(band.trueRadius).toBeLessThan(band.glyphRadius);
      expect(band.glyphRadius).toBeLessThan(band.degreeLabelRadius);
      expect(band.degreeLabelRadius).toBeLessThanOrEqual(band.outerRadius);
    }
  });
});
