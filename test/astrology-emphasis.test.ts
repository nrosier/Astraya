import { describe, expect, it } from 'vitest';
import { bodyByKey } from '../src/astrology/bodies.js';
import {
  dominantHouse,
  dominantPlanet,
  dominantSign,
  eastWestOf,
  elementBalance,
  hemisphereEmphasis,
  houseOf,
  modalityBalance,
  northSouthOf,
  quadrantEmphasis,
  quadrantOf,
} from '../src/astrology/emphasis.js';

function id(key: string): number {
  const body = bodyByKey(key);
  if (!body) throw new Error(`test fixture bug: unknown body key "${key}"`);
  return body.id;
}

/** 12 equal cusps starting at 0 Aries, i.e. whole-sign-like houses for a house-of-longitude sanity check. */
function equalCusps(ascendant: number): readonly number[] {
  return [NaN, ...Array.from({ length: 12 }, (_, i) => (ascendant + i * 30) % 360)];
}

describe('elementBalance (#36)', () => {
  it('tallies bodies by their sign element', () => {
    const positions = new Map([
      [id('sun'), 5], // Aries -> fire
      [id('moon'), 95], // Cancer -> water
      [id('mercury'), 15], // Aries -> fire
      [id('venus'), 200], // Libra -> air
    ]);
    expect(elementBalance(positions)).toEqual({ fire: 2, earth: 0, air: 1, water: 1 });
  });

  it('weighs bodies according to a given weight map', () => {
    const positions = new Map([
      [id('sun'), 5], // Aries -> fire
      [id('moon'), 95], // Cancer -> water
    ]);
    const weights = new Map([[id('sun'), 3]]);
    expect(elementBalance(positions, weights)).toEqual({ fire: 3, earth: 0, air: 0, water: 1 });
  });
});

describe('modalityBalance (#36)', () => {
  it('tallies bodies by their sign modality', () => {
    const positions = new Map([
      [id('sun'), 5], // Aries -> cardinal
      [id('moon'), 95], // Cancer -> cardinal
      [id('mercury'), 45], // Taurus -> fixed
    ]);
    expect(modalityBalance(positions)).toEqual({ cardinal: 2, fixed: 1, mutable: 0 });
  });
});

describe('quadrantOf (#36)', () => {
  const ascendant = 0;
  const midheaven = 280; // IC therefore sits at 100

  it('places bodies in Q1 between the Ascendant and IC', () => {
    expect(quadrantOf(50, ascendant, midheaven)).toBe(1);
  });

  it('places bodies in Q2 between the IC and Descendant', () => {
    expect(quadrantOf(150, ascendant, midheaven)).toBe(2);
  });

  it('places bodies in Q3 between the Descendant and MC', () => {
    expect(quadrantOf(200, ascendant, midheaven)).toBe(3);
  });

  it('places bodies in Q4 between the MC and Ascendant', () => {
    expect(quadrantOf(300, ascendant, midheaven)).toBe(4);
  });

  it('is independent of house system, depending only on the two angles', () => {
    expect(quadrantOf(ascendant, ascendant, midheaven)).toBe(1);
    expect(quadrantOf(midheaven, ascendant, midheaven)).toBe(4);
  });
});

describe('eastWestOf / northSouthOf (#36)', () => {
  it('classifies Q1 as eastern and northern (below the horizon)', () => {
    expect(eastWestOf(1)).toBe('eastern');
    expect(northSouthOf(1)).toBe('northern');
  });

  it('classifies Q2 as western and northern', () => {
    expect(eastWestOf(2)).toBe('western');
    expect(northSouthOf(2)).toBe('northern');
  });

  it('classifies Q3 as western and southern', () => {
    expect(eastWestOf(3)).toBe('western');
    expect(northSouthOf(3)).toBe('southern');
  });

  it('classifies Q4 as eastern and southern', () => {
    expect(eastWestOf(4)).toBe('eastern');
    expect(northSouthOf(4)).toBe('southern');
  });
});

describe('quadrantEmphasis / hemisphereEmphasis (#36)', () => {
  it('tallies each quadrant and derives hemispheres from them', () => {
    const ascendant = 0;
    const midheaven = 280;
    const positions = new Map([
      [id('sun'), 50], // Q1
      [id('moon'), 150], // Q2
      [id('mercury'), 200], // Q3
      [id('venus'), 300], // Q4
      [id('mars'), 310], // Q4
    ]);
    const quadrants = quadrantEmphasis(positions, ascendant, midheaven);
    expect(quadrants).toEqual({ q1: 1, q2: 1, q3: 1, q4: 2 });
    expect(hemisphereEmphasis(quadrants)).toEqual({ eastern: 3, western: 2, northern: 2, southern: 3 });
  });
});

describe('houseOf (#36)', () => {
  it('finds the house containing a longitude given equal 30-degree cusps', () => {
    const cusps = equalCusps(10); // house 1 starts at 10 Aries
    expect(houseOf(15, cusps)).toBe(1);
    expect(houseOf(41, cusps)).toBe(2);
    expect(houseOf(5, cusps)).toBe(12); // wraps back before the Ascendant
  });

  it('throws for a longitude that matches no house', () => {
    expect(() => houseOf(15, [NaN])).toThrow(RangeError);
  });
});

describe('dominantSign / dominantHouse / dominantPlanet (#36)', () => {
  it('picks the sign, house and ruling planet holding the most bodies', () => {
    const positions = new Map([
      [id('sun'), 5], // Aries, house 1
      [id('moon'), 20], // Aries, house 1
      [id('mercury'), 100], // Cancer, house 4
    ]);
    const cusps = equalCusps(0);
    expect(dominantSign(positions)).toBe(0); // Aries
    expect(dominantHouse(positions, cusps)).toBe(1);
    expect(dominantPlanet(positions)).toBe(id('mars')); // traditional ruler of Aries
  });

  it('lets weights break a tie', () => {
    const positions = new Map([
      [id('sun'), 5], // Aries
      [id('mercury'), 100], // Cancer
    ]);
    const weights = new Map([[id('mercury'), 2]]);
    expect(dominantSign(positions, weights)).toBe(3); // Cancer, outweighs Aries
  });

  it('returns undefined for an empty chart', () => {
    expect(dominantSign(new Map())).toBeUndefined();
    expect(dominantHouse(new Map(), equalCusps(0))).toBeUndefined();
    expect(dominantPlanet(new Map())).toBeUndefined();
  });
});
