import { describe, expect, it } from 'vitest';
import { antiscialContacts, antiscionOf, contraAntiscionOf } from '../src/astrology/antiscia.js';

describe('antiscionOf (#31)', () => {
  it('mirrors across the solstitial axis (Aries <-> Virgo)', () => {
    expect(antiscionOf(15)).toBe(165); // 15 Aries -> 15 Virgo
  });

  it('mirrors Taurus <-> Leo', () => {
    expect(antiscionOf(45)).toBe(135); // 15 Taurus -> 15 Leo
  });

  it('mirrors Gemini <-> Cancer, either side of the solstice point', () => {
    expect(antiscionOf(89)).toBe(91);
  });

  it('wraps to a positive longitude', () => {
    expect(antiscionOf(200)).toBe(340);
  });

  it('is its own inverse', () => {
    expect(antiscionOf(antiscionOf(37))).toBe(37);
  });
});

describe('contraAntiscionOf (#31)', () => {
  it('mirrors across the equinoctial axis (Aries <-> Pisces)', () => {
    expect(contraAntiscionOf(15)).toBe(345); // 15 Aries -> 15 Pisces
  });

  it('is 180 degrees from the antiscion', () => {
    expect(contraAntiscionOf(200)).toBe((antiscionOf(200) + 180) % 360);
  });

  it('wraps to a positive longitude', () => {
    expect(contraAntiscionOf(-40)).toBe(40);
  });

  it('is its own inverse', () => {
    expect(contraAntiscionOf(contraAntiscionOf(37))).toBe(37);
  });
});

describe('antiscialContacts (#31)', () => {
  it('finds a body sitting on another body antiscion within orb', () => {
    const positions = new Map([
      [0, 15], // sun, antiscion at 165
      [1, 165.5], // moon: near-conjunct the sun's antiscion
    ]);
    const contacts = antiscialContacts(positions, 1);
    expect(contacts).toEqual(
      expect.arrayContaining([expect.objectContaining({ body: 0, kind: 'antiscion', contact: 1 })]),
    );
  });

  it('finds a body sitting on another body contra-antiscion within orb', () => {
    const positions = new Map([
      [0, 15], // sun, contra-antiscion at 345
      [1, 344.5], // moon: near-conjunct the sun's contra-antiscion
    ]);
    const contacts = antiscialContacts(positions, 1);
    expect(contacts).toEqual(
      expect.arrayContaining([expect.objectContaining({ body: 0, kind: 'contraAntiscion', contact: 1 })]),
    );
  });

  it('omits contacts outside the given orb', () => {
    const positions = new Map([
      [0, 15],
      [1, 100],
    ]);
    expect(antiscialContacts(positions, 1)).toHaveLength(0);
  });

  it('never contacts the body against its own reflected point', () => {
    const positions = new Map([[0, 90]]); // antiscion and contra-antiscion of 90 are both 90
    expect(antiscialContacts(positions, 5)).toHaveLength(0);
  });
});
