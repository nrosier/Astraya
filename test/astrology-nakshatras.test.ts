import { describe, expect, it } from 'vitest';
import { NAKSHATRA_SPAN, NAKSHATRAS, PADA_SPAN, nakshatraPosition } from '../src/astrology/nakshatras.js';

describe('the canonical nakshatra registry (#22)', () => {
  it('has 27 nakshatras, indexed 0..26, with distinct names', () => {
    expect(NAKSHATRAS).toHaveLength(27);
    NAKSHATRAS.forEach((nakshatra, index) => {
      expect(nakshatra.index).toBe(index);
    });
    expect(new Set(NAKSHATRAS.map((n) => n.name)).size).toBe(27);
  });

  it('spans exactly 360 degrees, and a pada is a quarter of a nakshatra', () => {
    expect(NAKSHATRA_SPAN * 27).toBeCloseTo(360, 10);
    expect(PADA_SPAN * 4).toBeCloseTo(NAKSHATRA_SPAN, 10);
  });

  it('assigns lords following the classical 9-planet Vimshottari cycle', () => {
    const cycle = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'];
    NAKSHATRAS.forEach((nakshatra, index) => {
      expect(nakshatra.lord).toBe(cycle[index % 9]);
    });

    // Named checks at the cycle boundaries, so a reordering of the array
    // can't accidentally satisfy the modulo check above.
    expect(NAKSHATRAS[0]?.name).toBe('Ashwini');
    expect(NAKSHATRAS[0]?.lord).toBe('Ketu');
    expect(NAKSHATRAS[8]?.name).toBe('Ashlesha');
    expect(NAKSHATRAS[8]?.lord).toBe('Mercury');
    expect(NAKSHATRAS[9]?.name).toBe('Magha');
    expect(NAKSHATRAS[9]?.lord).toBe('Ketu');
    expect(NAKSHATRAS[26]?.name).toBe('Revati');
    expect(NAKSHATRAS[26]?.lord).toBe('Mercury');
  });
});

describe('nakshatraPosition (#22)', () => {
  it('places 0 degrees at the start of Ashwini', () => {
    const position = nakshatraPosition(0);
    expect(position.nakshatra.name).toBe('Ashwini');
    expect(position.pada).toBe(1);
    expect(position.degreesInNakshatra).toBe(0);
  });

  it('places the last representable longitude in Revati, pada 4', () => {
    const position = nakshatraPosition(359.999999);
    expect(position.nakshatra.name).toBe('Revati');
    expect(position.pada).toBe(4);
  });

  it("rolls over to the next nakshatra exactly at each 13°20' boundary", () => {
    const justBefore = nakshatraPosition(NAKSHATRA_SPAN - 1e-9);
    const atBoundary = nakshatraPosition(NAKSHATRA_SPAN);

    expect(justBefore.nakshatra.index).toBe(0);
    expect(atBoundary.nakshatra.index).toBe(1);
    expect(atBoundary.degreesInNakshatra).toBe(0);
    expect(atBoundary.pada).toBe(1);
  });

  it("rolls over to the next pada exactly at each 3°20' boundary", () => {
    for (let pada = 1; pada <= 4; pada++) {
      const start = (pada - 1) * PADA_SPAN;
      const position = nakshatraPosition(start);
      expect(position.pada, `pada ${pada} start`).toBe(pada);

      if (pada < 4) {
        const justBefore = nakshatraPosition(start + PADA_SPAN - 1e-9);
        expect(justBefore.pada, `pada ${pada} end`).toBe(pada);
      }
    }
  });

  it('agrees on nakshatra index at every nakshatra boundary across the full circle', () => {
    for (let index = 0; index < 27; index++) {
      const position = nakshatraPosition(index * NAKSHATRA_SPAN);
      expect(position.nakshatra.index).toBe(index);
      expect(position.degreesInNakshatra).toBe(0);
    }
  });

  it('rejects longitudes outside [0, 360)', () => {
    expect(() => nakshatraPosition(360)).toThrow(RangeError);
    expect(() => nakshatraPosition(-1)).toThrow(RangeError);
  });
});
