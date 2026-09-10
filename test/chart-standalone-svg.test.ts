import { describe, expect, it } from 'vitest';
import { standaloneSvg } from '../src/chart/standalone-svg.js';

describe('standaloneSvg (#67)', () => {
  it('inserts a style element right after the opening svg tag', () => {
    const input =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle class="wheel-ring-outer" /></svg>';
    const result = standaloneSvg(input);
    expect(result.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>')).toBe(true);
    expect(result.endsWith('<circle class="wheel-ring-outer" /></svg>')).toBe(true);
  });

  it('covers every class the renderers in this directory actually emit', () => {
    const result = standaloneSvg('<svg><g /></svg>');
    for (const className of [
      'wheel-ring-outer',
      'wheel-ring-inner',
      'chart-multiwheel-ring',
      'wheel-sign-boundary',
      'wheel-tick-major',
      'wheel-tick-minor',
      'chart-multiwheel-cusp',
      'chart-multiwheel-cusp-angle',
      'chart-glyph',
      'glyph-fill',
      'chart-glyph-leader',
      'chart-aspect',
      'chart-aspect-applying',
      'chart-multiwheel-legend-swatch',
      'wheel-ring-zodiac',
      'wheel-ring-aspect',
      'wheel-tick-medium',
      'chart-sign-glyph',
      'chart-house-number',
      'chart-degree-label',
      'chart-multiwheel-axis',
      'chart-multiwheel-legend-label',
      'chart-sheet-title',
      'chart-sheet-meta',
      'chart-panel-heading',
      'chart-panel-rule',
      'chart-matrix-cell',
      'chart-matrix-diagonal',
      'chart-matrix-label',
      'chart-matrix-orb',
      'chart-aspect-glyph',
      'chart-emphasis-cell',
      'chart-emphasis-total',
      'chart-strip-axis',
      'chart-strip-tick',
      'chart-strip-tick-major',
      'chart-strip-label',
    ]) {
      expect(result).toContain(className);
    }
  });

  it('is well-formed enough to still be exactly one svg document', () => {
    const result = standaloneSvg('<svg viewBox="0 0 1 1"></svg>');
    expect(result.match(/<svg/g)).toHaveLength(1);
    expect(result.match(/<\/svg>/g)).toHaveLength(1);
  });
});
