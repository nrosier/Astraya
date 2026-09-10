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

interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

function describeSegment(segment: Segment): string {
  return `(${String(segment.x1)},${String(segment.y1)})-(${String(segment.x2)},${String(segment.y2)})`;
}

/**
 * Every straight `M …  L …` run in the glyph's paths. Paths containing a curve
 * are skipped: a `Q` control point makes the endpoints no guide to where the
 * ink actually goes, and a curve cannot hide inside a line anyway.
 */
function straightSegments(elements: readonly string[]): Segment[] {
  const segments: Segment[] = [];
  for (const element of elements) {
    const data = /<path d="([^"]+)"/.exec(element)?.[1];
    if (data === undefined || /[QqCcAaSsTt]/.test(data)) continue;
    let current: { x: number; y: number } | undefined;
    for (const [, command, x, y] of data.matchAll(/([ML])\s*(-?[\d.]+)\s+(-?[\d.]+)/g)) {
      if (x === undefined || y === undefined) continue;
      const point = { x: Number(x), y: Number(y) };
      if (command === 'L' && current) segments.push({ x1: current.x, y1: current.y, x2: point.x, y2: point.y });
      current = point;
    }
  }
  return segments;
}

/** True when the two segments lie on one line and share more than a single point. */
function overlapsCollinear(a: Segment, b: Segment): boolean {
  const ax = a.x2 - a.x1;
  const ay = a.y2 - a.y1;
  const bx = b.x2 - b.x1;
  const by = b.y2 - b.y1;
  const parallel = Math.abs(ax * by - ay * bx) < 1e-6;
  if (!parallel) return false;
  // Same line, not merely the same direction: b's start must sit on a's line.
  const onSameLine = Math.abs(ax * (b.y1 - a.y1) - ay * (b.x1 - a.x1)) < 1e-6;
  if (!onSameLine) return false;
  // Project both onto a's direction and look for a shared interval, not just a
  // shared endpoint — segments meeting at a corner are fine.
  const project = (x: number, y: number): number => (x - a.x1) * ax + (y - a.y1) * ay;
  const span = ax * ax + ay * ay;
  const from = project(b.x1, b.y1);
  const to = project(b.x2, b.y2);
  return Math.min(Math.max(from, to), span) - Math.max(Math.min(from, to), 0) > 1e-6;
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

  it('draws each sign as its own shape, not the artwork of another glyph', () => {
    // Coverage tests only ask whether a glyph exists, so the nearest thing to a
    // machine-checkable "is it the right shape" is that no two of them are the
    // same shape. The two nodes are the deliberate exception — they mark one
    // point by two definitions and are drawn identically on purpose.
    const seen = new Map<string, string>();
    for (const g of allGlyphs) {
      if (g.key === 'trueNode') continue;
      const artwork = g.elements.join('');
      const owner = seen.get(artwork);
      expect(owner, `${g.key} draws the same artwork as ${String(owner)}`).toBeUndefined();
      seen.set(artwork, g.key);
    }
  });

  it('leaves no straight segment hidden inside another segment of the same glyph', () => {
    // Sagittarius' crossbar was once collinear with its own shaft, so it drew
    // nothing at all. A segment that lies along another is invisible however
    // large the glyph is rendered, so it can only be caught geometrically.
    for (const g of allGlyphs) {
      const segments = straightSegments(g.elements);
      for (let i = 0; i < segments.length; i += 1) {
        for (let j = i + 1; j < segments.length; j += 1) {
          const [a, b] = [segments[i], segments[j]];
          if (!a || !b) continue;
          expect(overlapsCollinear(a, b), `${g.key}: ${describeSegment(a)} hides inside ${describeSegment(b)}`).toBe(
            false,
          );
        }
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
