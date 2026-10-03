import { describe, expect, it } from 'vitest';
import { resolveRingBands, resolveSheetGeometry } from '../src/chart/sheet-geometry.js';

/** The reference layout is specified at this size, so it is the one size with literal expectations. */
const REFERENCE_SIZE = 800;

describe('resolveSheetGeometry', () => {
  it('reproduces the reference layout exactly at size 800', () => {
    const geometry = resolveSheetGeometry(REFERENCE_SIZE);
    expect(geometry.zodiacOuter).toBe(380);
    expect(geometry.zodiacInner).toBe(330);
    expect(geometry.signGlyphRadius).toBe(355);
    expect(geometry.planetRingOuter).toBe(316);
    expect(geometry.houseRing).toBe(200);
    expect(geometry.aspectCircle).toBe(164);
  });

  it('puts the reference tick lengths on the three tiers', () => {
    const geometry = resolveSheetGeometry(REFERENCE_SIZE);
    expect(geometry.tickMinorLength).toBe(4);
    expect(geometry.tickMediumLength).toBe(7);
    expect(geometry.tickMajorLength).toBe(11);
  });

  it('centers the chart in its own box', () => {
    const geometry = resolveSheetGeometry(500);
    expect(geometry.cx).toBe(250);
    expect(geometry.cy).toBe(250);
  });

  it('places house numbers in the inner house dial, between the aspect circle and the planet band (#412)', () => {
    const geometry = resolveSheetGeometry(REFERENCE_SIZE);
    expect(geometry.houseNumberRadius).toBeGreaterThan(geometry.aspectCircle);
    expect(geometry.houseNumberRadius).toBeLessThan(geometry.houseRing);
  });

  it('keeps the ruler ticks inside the zodiac dial edge but clear of the planet band', () => {
    const geometry = resolveSheetGeometry(REFERENCE_SIZE);
    expect(geometry.zodiacInner - geometry.tickMajorLength).toBeGreaterThan(geometry.planetRingOuter);
  });

  it('keeps every radius in the expected order, at any size', () => {
    for (const size of [200, 600, 800, 2400]) {
      const g = resolveSheetGeometry(size);
      expect(g.aspectCircle).toBeLessThan(g.houseNumberRadius);
      expect(g.houseNumberRadius).toBeLessThan(g.houseRing);
      expect(g.houseRing).toBeLessThan(g.planetRingOuter);
      expect(g.planetRingOuter).toBeLessThan(g.zodiacInner);
      expect(g.zodiacInner).toBeLessThan(g.signGlyphRadius);
      expect(g.signGlyphRadius).toBeLessThan(g.zodiacOuter);
      // The outer edge has to stay inside the box it is centred in.
      expect(g.zodiacOuter).toBeLessThan(size / 2);
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

  it('spans exactly the house ring to the planet band edge, leaving the house dial and aspect disk free', () => {
    const geometry = resolveSheetGeometry(REFERENCE_SIZE);
    const bands = resolveRingBands(geometry, 3);
    expect(bands).toHaveLength(3);
    expect(bands[0]?.innerRadius).toBe(geometry.houseRing);
    expect(bands[2]?.outerRadius).toBeCloseTo(geometry.planetRingOuter, 6);
  });

  it('divides the span into equal, non-overlapping bands ordered innermost first', () => {
    const bands = resolveRingBands(resolveSheetGeometry(REFERENCE_SIZE), 3);
    const widths = bands.map((band) => band.outerRadius - band.innerRadius);
    expect(widths[0]).toBeCloseTo(widths[1] ?? 0, 6);
    expect(widths[1]).toBeCloseTo(widths[2] ?? 0, 6);
    expect(bands[0]?.outerRadius).toBeCloseTo(bands[1]?.innerRadius ?? 0, 6);
    expect(bands[1]?.outerRadius).toBeCloseTo(bands[2]?.innerRadius ?? 0, 6);
  });

  it('stacks a single ring glyph outermost, then degree, sign and minutes towards the house dial (#412)', () => {
    const [band] = resolveRingBands(resolveSheetGeometry(REFERENCE_SIZE), 1);
    if (band === undefined) throw new Error('expected one band');
    expect(band.trueRadius).toBe(band.outerRadius);
    expect(band.glyphRadius).toBeLessThan(band.trueRadius);
    expect(band.degreeLabelRadius).toBeLessThan(band.glyphRadius);
    expect(band.signLabelRadius).toBeLessThan(band.degreeLabelRadius);
    expect(band.minuteLabelRadius).toBeLessThan(band.signLabelRadius);
    expect(band.minuteLabelRadius).toBeGreaterThan(band.innerRadius);
  });

  it('keeps each stacked band leader start outside its glyphs and inside the band', () => {
    for (const band of resolveRingBands(resolveSheetGeometry(REFERENCE_SIZE), 2)) {
      expect(band.glyphRadius).toBeGreaterThan(band.innerRadius);
      expect(band.trueRadius).toBeGreaterThan(band.glyphRadius);
      expect(band.trueRadius).toBeLessThanOrEqual(band.outerRadius);
    }
  });
});
