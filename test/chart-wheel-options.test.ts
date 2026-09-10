import { describe, expect, it } from 'vitest';
import { resolveWheelDisplayOptions } from '../src/chart/wheel-options.js';

describe('resolveWheelDisplayOptions (#43)', () => {
  it('defaults every option when settings is empty', () => {
    expect(resolveWheelDisplayOptions({})).toEqual({
      orientation: 'asc-left',
      sweep: 'counterclockwise',
      houseWedgeStyle: 'equal-degree',
      signWedgeStyle: 'default',
    });
  });

  it('reads a recognised value for each setting', () => {
    expect(
      resolveWheelDisplayOptions({
        wheelOrientation: 'aries-up',
        wheelSweep: 'clockwise',
        houseWedgeStyle: 'whole-sign',
        signWedgeStyle: 'rainbow',
      }),
    ).toEqual({
      orientation: 'aries-up',
      sweep: 'clockwise',
      houseWedgeStyle: 'whole-sign',
      signWedgeStyle: 'rainbow',
    });
  });

  it('falls back to the default for an unrecognised value rather than throwing', () => {
    expect(
      resolveWheelDisplayOptions({
        wheelOrientation: 'sideways', // a newer build's value, or plain corruption
        wheelSweep: 3, // wrong type entirely
        houseWedgeStyle: null,
        signWedgeStyle: 'psychedelic',
      }),
    ).toEqual({
      orientation: 'asc-left',
      sweep: 'counterclockwise',
      houseWedgeStyle: 'equal-degree',
      signWedgeStyle: 'default',
    });
  });

  it('ignores unrelated settings kept alongside the wheel-display ones', () => {
    const result = resolveWheelDisplayOptions({
      houseSystem: 'P',
      wheelOrientation: 'aries-up',
      zodiac: 'tropical',
    });
    expect(result.orientation).toBe('aries-up');
  });
});
