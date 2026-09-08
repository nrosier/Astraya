import { describe, expect, it } from 'vitest';
import { resolveOverlayDisplayOptions } from '../src/chart/overlay-options.js';

describe('resolveOverlayDisplayOptions (#148)', () => {
  it('defaults every option when settings is empty', () => {
    expect(resolveOverlayDisplayOptions({})).toEqual({
      antisciaVisible: false,
      antisciaMaxOrb: 1,
      declinationVisible: false,
      declinationMaxOrb: 1,
      dial90Visible: false,
      midpointTreeOrb: 1,
    });
  });

  it('reads a recognised value for each setting', () => {
    const result = resolveOverlayDisplayOptions({
      antisciaVisible: true,
      antisciaMaxOrb: 2.5,
      declinationVisible: true,
      declinationMaxOrb: 0.5,
      dial90Visible: true,
      midpointTreeOrb: 1.5,
    });
    expect(result).toEqual({
      antisciaVisible: true,
      antisciaMaxOrb: 2.5,
      declinationVisible: true,
      declinationMaxOrb: 0.5,
      dial90Visible: true,
      midpointTreeOrb: 1.5,
    });
  });

  it('falls back to the default for an unrecognised value rather than throwing', () => {
    const result = resolveOverlayDisplayOptions({
      antisciaVisible: 'yes',
      antisciaMaxOrb: -1,
      declinationVisible: null,
      declinationMaxOrb: 'wide',
      dial90Visible: 1,
      midpointTreeOrb: Number.NaN,
    });
    expect(result).toEqual({
      antisciaVisible: false,
      antisciaMaxOrb: 1,
      declinationVisible: false,
      declinationMaxOrb: 1,
      dial90Visible: false,
      midpointTreeOrb: 1,
    });
  });

  it('ignores unrelated settings kept alongside the overlay ones', () => {
    const result = resolveOverlayDisplayOptions({
      houseSystem: 'P',
      antisciaVisible: true,
      zodiac: 'tropical',
    });
    expect(result.antisciaVisible).toBe(true);
  });

  it('accepts a zero orb (a fully exact-only filter) rather than treating it as falsy/missing', () => {
    expect(resolveOverlayDisplayOptions({ antisciaMaxOrb: 0 }).antisciaMaxOrb).toBe(0);
  });
});
