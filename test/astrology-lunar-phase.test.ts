import { describe, expect, it } from 'vitest';
import { LUNAR_PHASES, lunarPhaseOf } from '../src/astrology/lunar-phase.js';

describe('lunarPhaseOf (#403)', () => {
  it('names each of the eight phases from its own 45° slice, counted from the conjunction', () => {
    LUNAR_PHASES.forEach((phase, index) => {
      // Middle of the slice, so no boundary is involved.
      expect(lunarPhaseOf(index * 45 + 22.5, 0).phase).toBe(phase);
    });
  });

  it('starts each phase at its lower bound: exactly 90° is the First Quarter, exactly 180° the Full Moon', () => {
    expect(lunarPhaseOf(0, 0).phase).toBe('new');
    expect(lunarPhaseOf(44.999, 0).phase).toBe('new');
    expect(lunarPhaseOf(45, 0).phase).toBe('crescent');
    expect(lunarPhaseOf(90, 0).phase).toBe('first-quarter');
    expect(lunarPhaseOf(180, 0).phase).toBe('full');
    expect(lunarPhaseOf(270, 0).phase).toBe('last-quarter');
    expect(lunarPhaseOf(315, 0).phase).toBe('balsamic');
    expect(lunarPhaseOf(359.999, 0).phase).toBe('balsamic');
  });

  it('matches the Astro-Seek reference: a Moon 337°28′ ahead of the Sun is a Balsamic Moon', () => {
    const result = lunarPhaseOf(100 + 337 + 28 / 60, 100);
    expect(result.phase).toBe('balsamic');
    expect(result.elongation).toBeCloseTo(337.4667, 3);
  });

  it('measures elongation as Moon minus Sun, wrapping around 360°', () => {
    // Sun late in Pisces, Moon early in Aries: only a few degrees ahead of it, so just after the New Moon.
    const result = lunarPhaseOf(5, 355);
    expect(result.elongation).toBeCloseTo(10, 9);
    expect(result.phase).toBe('new');
    expect(result.waxing).toBe(true);
  });

  it('tells waxing from waning', () => {
    expect(lunarPhaseOf(120, 0).waxing).toBe(true);
    expect(lunarPhaseOf(179.9, 0).waxing).toBe(true);
    expect(lunarPhaseOf(180, 0).waxing).toBe(false);
    expect(lunarPhaseOf(300, 0).waxing).toBe(false);
  });

  it('is 0% lit at the New Moon, 50% at the quarters and 100% at the Full Moon', () => {
    expect(lunarPhaseOf(0, 0).illumination).toBeCloseTo(0, 9);
    expect(lunarPhaseOf(90, 0).illumination).toBeCloseTo(0.5, 9);
    expect(lunarPhaseOf(180, 0).illumination).toBeCloseTo(1, 9);
    expect(lunarPhaseOf(270, 0).illumination).toBeCloseTo(0.5, 9);
  });

  it('is symmetric: the same elongation either side of the Full Moon is equally lit', () => {
    expect(lunarPhaseOf(135, 0).illumination).toBeCloseTo(lunarPhaseOf(225, 0).illumination, 9);
  });

  it('gives the same answer whichever turn of the zodiac the pair sits in', () => {
    expect(lunarPhaseOf(210, 30).elongation).toBeCloseTo(lunarPhaseOf(180, 0).elongation, 9);
    expect(lunarPhaseOf(-30, 150).elongation).toBeCloseTo(180, 9);
  });
});
