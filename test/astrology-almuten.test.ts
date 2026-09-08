import { describe, expect, it } from 'vitest';
import { almutenFigurisOf, almutenOf, essentialDignityScoreOf } from '../src/astrology/almuten.js';
import { bodyByKey } from '../src/astrology/bodies.js';

function id(key: string): number {
  const body = bodyByKey(key);
  if (!body) throw new Error(`test fixture bug: unknown body key "${key}"`);
  return body.id;
}

// Aries 3 degrees: first decan (face ruler Mars), Egyptian bound ruler
// Jupiter (0-6), exaltation ruler Sun, domicile ruler Mars, fire triplicity
// day/night/participating = Sun/Jupiter/Saturn.
const ARIES_3 = 3;

describe('essentialDignityScoreOf (#27)', () => {
  it('sums 5/4/3/2/1 for ruler/exaltation/triplicity/bound/face, and flags peregrine at zero', () => {
    const sun = essentialDignityScoreOf(id('sun'), ARIES_3, 'day');
    expect(sun.ruler).toBe(false);
    expect(sun.exalted).toBe(true);
    expect(sun.triplicity).toBe(true); // sect-appropriate (day) ruler of fire
    expect(sun.bound).toBe(false); // Jupiter holds Aries 0-6, not Sun
    expect(sun.face).toBe(false); // Mars holds the first face, not Sun
    expect(sun.points).toBe(4 + 3);
    expect(sun.peregrine).toBe(false);

    const mars = essentialDignityScoreOf(id('mars'), ARIES_3, 'day');
    expect(mars.ruler).toBe(true);
    expect(mars.face).toBe(true);
    expect(mars.points).toBe(5 + 1);

    const moon = essentialDignityScoreOf(id('moon'), ARIES_3, 'day');
    expect(moon.ruler).toBe(false);
    expect(moon.exalted).toBe(false);
    expect(moon.triplicity).toBe(false);
    expect(moon.bound).toBe(false);
    expect(moon.face).toBe(false);
    expect(moon.points).toBe(0);
    expect(moon.peregrine).toBe(true);
  });

  it('only scores the sect-appropriate triplicity ruler, day vs night', () => {
    // Fire triplicity day ruler Sun, night ruler Jupiter.
    expect(essentialDignityScoreOf(id('sun'), ARIES_3, 'day').triplicity).toBe(true);
    expect(essentialDignityScoreOf(id('sun'), ARIES_3, 'night').triplicity).toBe(false);
    expect(essentialDignityScoreOf(id('jupiter'), ARIES_3, 'night').triplicity).toBe(true);
    expect(essentialDignityScoreOf(id('jupiter'), ARIES_3, 'day').triplicity).toBe(false);
  });

  it('never scores the participating triplicity ruler, in either sect', () => {
    // Saturn is fire's participating ruler, neither day nor night.
    expect(essentialDignityScoreOf(id('saturn'), ARIES_3, 'day').triplicity).toBe(false);
    expect(essentialDignityScoreOf(id('saturn'), ARIES_3, 'night').triplicity).toBe(false);
  });

  it('respects the rulershipScheme and boundsScheme options', () => {
    // Aquarius 3: traditional ruler Saturn, modern ruler Uranus.
    const AQUARIUS_3 = 10 * 30 + 3;
    expect(essentialDignityScoreOf(id('saturn'), AQUARIUS_3, 'day', { rulershipScheme: 'traditional' }).ruler).toBe(
      true,
    );
    expect(essentialDignityScoreOf(id('uranus'), AQUARIUS_3, 'day', { rulershipScheme: 'modern' }).ruler).toBe(true);

    // Capricorn 3: Egyptian bound ruler Mercury, Ptolemaic bound ruler Venus.
    const CAPRICORN_3 = 9 * 30 + 3;
    expect(essentialDignityScoreOf(id('mercury'), CAPRICORN_3, 'day', { boundsScheme: 'egyptian' }).bound).toBe(true);
    expect(essentialDignityScoreOf(id('venus'), CAPRICORN_3, 'day', { boundsScheme: 'ptolemaic' }).bound).toBe(true);
  });
});

describe('almutenOf (#27)', () => {
  it('picks the traditional planet with the highest dignity score at a degree', () => {
    // Hand-scored above: Saturn 0, Jupiter 2 (bound), Mars 6 (ruler+face),
    // Sun 7 (exaltation+triplicity), Venus 0, Mercury 0, Moon 0.
    const result = almutenOf(ARIES_3, 'day');
    expect(result.points).toBe(7);
    expect(result.almutens).toEqual([id('sun')]);
    expect(result.scores).toHaveLength(7);
  });

  it('changes the winner when sect flips which triplicity ruler is active', () => {
    // At night, Sun loses its triplicity points (4) and Jupiter gains its
    // triplicity points (2 bound + 3 triplicity = 5) while Mars keeps its
    // ruler+face total of 6, so Mars becomes the sole almuten.
    const result = almutenOf(ARIES_3, 'night');
    expect(result.almutens).toEqual([id('mars')]);
    expect(result.points).toBe(6);
  });
});

describe('almutenFigurisOf (#27)', () => {
  it('sums each planet across every supplied vital point', () => {
    const single = almutenOf(ARIES_3, 'day');
    const figuris = almutenFigurisOf([ARIES_3], 'day');
    expect(figuris.points).toBe(single.points);
    expect(figuris.almutens).toEqual(single.almutens);
  });

  it('accumulates points across multiple points rather than overwriting them', () => {
    // Reuse the same point twice so the expected total is unambiguous: it
    // must be exactly double the single-point score.
    const marsAlone = essentialDignityScoreOf(id('mars'), ARIES_3, 'day').points;
    const figuris = almutenFigurisOf([ARIES_3, ARIES_3], 'day');
    const marsScore = figuris.scores.find((s) => s.body === id('mars'));
    expect(marsScore?.points).toBe(marsAlone * 2);
  });

  it('rejects an empty vital-point list rather than silently returning a meaningless result', () => {
    expect(() => almutenFigurisOf([], 'day')).toThrow(RangeError);
  });
});
