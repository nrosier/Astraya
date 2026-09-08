import { describe, expect, it } from 'vitest';
import { BODIES } from '../src/astrology/bodies.js';
import { SIGNS } from '../src/astrology/signs.js';
import { ASPECTS } from '../src/astrology/aspects.js';
import { aspectGlyph, bodyGlyph, renderGlyph, signGlyph } from '../src/chart/glyphs.js';
import type { GlyphDefinition } from '../src/chart/glyphs.js';

/** Every numeric coordinate that appears in a primitive's attributes or path data. */
function extractCoordinates(elements: readonly string[]): number[] {
  const coordinates: number[] = [];
  for (const element of elements) {
    // Path `d` attributes mix command letters with numbers; strip the
    // letters (and the transform/flag noise) so every remaining token is a
    // plain coordinate value, which is all this test cares about.
    const numeric = element.replace(/[A-Za-z"=/<>]/g, ' ');
    for (const token of numeric.split(/[\s,]+/)) {
      if (token.trim() === '') continue;
      const value = Number(token);
      if (!Number.isNaN(value)) coordinates.push(value);
    }
  }
  return coordinates;
}

describe('glyph coverage (#40)', () => {
  it('defines a glyph for every entry in BODIES', () => {
    for (const body of BODIES) {
      expect(bodyGlyph(body.key), body.key).toBeDefined();
    }
  });

  it('defines a glyph for the derived south node, alongside the BODIES-covered north node', () => {
    expect(bodyGlyph('southNode')).toBeDefined();
  });

  it('defines a glyph for every entry in SIGNS', () => {
    for (const sign of SIGNS) {
      expect(signGlyph(sign.name), sign.name).toBeDefined();
    }
  });

  it('defines a glyph for every entry in ASPECTS', () => {
    for (const aspect of ASPECTS) {
      expect(aspectGlyph(aspect.key), aspect.key).toBeDefined();
    }
  });

  it('returns undefined for an unknown key rather than throwing', () => {
    expect(bodyGlyph('notARealBody')).toBeUndefined();
    expect(signGlyph('NotARealSign')).toBeUndefined();
    expect(aspectGlyph('notARealAspect')).toBeUndefined();
  });
});

describe('glyph geometry (#40)', () => {
  const allGlyphs: GlyphDefinition[] = [
    ...BODIES.map((b) => bodyGlyph(b.key)),
    bodyGlyph('southNode'),
    ...SIGNS.map((s) => signGlyph(s.name)),
    ...ASPECTS.map((a) => aspectGlyph(a.key)),
  ].filter((g): g is GlyphDefinition => g !== undefined);

  it('covers all 20 bodies, the south node, 12 signs and 11 aspects with no gaps', () => {
    expect(allGlyphs.length).toBe(20 + 1 + 12 + 11);
  });

  it('draws at least one primitive per glyph', () => {
    for (const g of allGlyphs) {
      expect(g.elements.length, g.key).toBeGreaterThan(0);
    }
  });

  it("keeps every primitive's coordinates within the documented 0-100 box", () => {
    for (const g of allGlyphs) {
      const coordinates = extractCoordinates(g.elements);
      expect(coordinates.length, g.key).toBeGreaterThan(0);
      for (const value of coordinates) {
        expect(value, `${g.key}: ${String(value)}`).toBeGreaterThanOrEqual(0);
        expect(value, `${g.key}: ${String(value)}`).toBeLessThanOrEqual(100);
      }
    }
  });

  it('only ever emits path, circle and rect primitives', () => {
    for (const g of allGlyphs) {
      for (const element of g.elements) {
        expect(/^<(path|circle|rect)\b/.test(element), `${g.key}: ${element}`).toBe(true);
      }
    }
  });
});

describe('renderGlyph (#40)', () => {
  const sun = bodyGlyph('sun');
  if (!sun) throw new Error('test fixture bug: missing sun glyph');

  it('wraps the glyph in a <g> with the requested class', () => {
    const svg = renderGlyph(sun, 50, 50, 40, 'chart-glyph-sun');
    expect(svg.startsWith('<g ')).toBe(true);
    expect(svg).toContain('class="chart-glyph-sun"');
    expect(svg.endsWith('</g>')).toBe(true);
  });

  it('scales the 0-100 box to the requested pixel size and centers it on (cx, cy)', () => {
    const svg = renderGlyph(sun, 100, 200, 50, 'g');
    // size 50 over a 100-unit box is a 0.5 scale; centering a 50px box on
    // (100, 200) puts its top-left corner at (75, 175).
    expect(svg).toContain('translate(75.00 175.00) scale(0.5000)');
  });

  it("includes every one of the glyph definition's primitives", () => {
    const svg = renderGlyph(sun, 0, 0, 100, 'g');
    for (const element of sun.elements) {
      expect(svg).toContain(element);
    }
  });
});
