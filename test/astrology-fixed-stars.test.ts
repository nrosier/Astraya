import { describe, expect, it } from 'vitest';
import { bodyByKey } from '../src/astrology/bodies.js';
import { armcAtAngle, fixedStarConjunctions, parans, type EquatorialPoint } from '../src/astrology/fixed-stars.js';

function id(key: string): number {
  const body = bodyByKey(key);
  if (!body) throw new Error(`test fixture bug: unknown body key "${key}"`);
  return body.id;
}

describe('fixedStarConjunctions (#33)', () => {
  it('finds every star/body pair within orb', () => {
    const stars = new Map([
      ['Regulus', 150],
      ['Spica', 204],
    ]);
    const positions = new Map([
      [id('sun'), 150.5], // conjunct Regulus
      [id('moon'), 90], // conjunct neither
    ]);
    const contacts = fixedStarConjunctions(stars, positions, 1);
    expect(contacts).toEqual([{ star: 'Regulus', body: id('sun'), orb: 0.5 }]);
  });

  it('returns nothing when no pair is within orb', () => {
    const stars = new Map([['Regulus', 150]]);
    const positions = new Map([[id('sun'), 90]]);
    expect(fixedStarConjunctions(stars, positions, 1)).toEqual([]);
  });
});

describe('armcAtAngle (#33)', () => {
  const equatorPoint: EquatorialPoint = { rightAscension: 100, declination: 0 };

  it('culminates when ARMC equals the right ascension', () => {
    expect(armcAtAngle(equatorPoint, 40, 'culminating')).toBe(100);
  });

  it('anticulminates 180 degrees later', () => {
    expect(armcAtAngle(equatorPoint, 40, 'anticulminating')).toBe(280);
  });

  it('rises and sets symmetrically around culmination for a point on the equator', () => {
    // On the celestial equator the semi-diurnal arc is exactly 90 degrees at any latitude.
    expect(armcAtAngle(equatorPoint, 40, 'rising')).toBeCloseTo(10, 6);
    expect(armcAtAngle(equatorPoint, 40, 'setting')).toBeCloseTo(190, 6);
  });

  it('is undefined for rising/setting when the point is circumpolar at that latitude', () => {
    const highDeclination: EquatorialPoint = { rightAscension: 0, declination: 80 };
    expect(armcAtAngle(highDeclination, 60, 'rising')).toBeUndefined();
    expect(armcAtAngle(highDeclination, 60, 'setting')).toBeUndefined();
    // Culmination is unaffected by circumpolarity.
    expect(armcAtAngle(highDeclination, 60, 'culminating')).toBe(0);
  });
});

describe('parans (#33)', () => {
  it('finds an angle pair whose ARMC values coincide within orb', () => {
    const a: EquatorialPoint = { rightAscension: 100, declination: 0 };
    const b: EquatorialPoint = { rightAscension: 100.4, declination: 0 };
    // Both culminate at nearly the same ARMC (100 vs 100.4).
    const results = parans(a, b, 40, 1);
    const culmination = results.find((p) => p.angleA === 'culminating' && p.angleB === 'culminating');
    expect(culmination?.orb).toBeCloseTo(0.4, 6);
  });

  it('finds no parans when nothing lines up within orb', () => {
    const a: EquatorialPoint = { rightAscension: 0, declination: 0 };
    const b: EquatorialPoint = { rightAscension: 45, declination: 0 };
    expect(parans(a, b, 40, 0.5)).toEqual([]);
  });

  it('omits angle pairs where one point is circumpolar and cannot rise or set', () => {
    const circumpolar: EquatorialPoint = { rightAscension: 0, declination: 80 };
    const ordinary: EquatorialPoint = { rightAscension: 0, declination: 0 };
    const results = parans(circumpolar, ordinary, 60, 5);
    for (const paran of results) {
      expect(paran.angleA).not.toBe('rising');
      expect(paran.angleA).not.toBe('setting');
    }
  });
});
