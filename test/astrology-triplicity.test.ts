import { describe, expect, it } from 'vitest';
import { bodyByKey } from '../src/astrology/bodies.js';
import { triplicityRoleOf, triplicityRulersAt, triplicityRulersOf } from '../src/astrology/triplicity.js';

function id(key: string): number {
  const body = bodyByKey(key);
  if (!body) throw new Error(`test fixture bug: unknown body key "${key}"`);
  return body.id;
}

describe('triplicityRulersOf (#26)', () => {
  it('matches the Dorothean/Lilly table for all four elements', () => {
    expect(triplicityRulersOf('fire')).toEqual({ day: id('sun'), night: id('jupiter'), participating: id('saturn') });
    expect(triplicityRulersOf('earth')).toEqual({
      day: id('venus'),
      night: id('moon'),
      participating: id('mars'),
    });
    expect(triplicityRulersOf('air')).toEqual({
      day: id('saturn'),
      night: id('mercury'),
      participating: id('jupiter'),
    });
    expect(triplicityRulersOf('water')).toEqual({
      day: id('venus'),
      night: id('mars'),
      participating: id('moon'),
    });
  });
});

describe('triplicityRulersAt (#26)', () => {
  it('gives every sign of a triplicity the same rulers', () => {
    // Aries, Leo, Sagittarius: fire.
    const fire = triplicityRulersOf('fire');
    expect(triplicityRulersAt(10)).toEqual(fire); // Aries
    expect(triplicityRulersAt(4 * 30 + 10)).toEqual(fire); // Leo
    expect(triplicityRulersAt(8 * 30 + 10)).toEqual(fire); // Sagittarius
  });

  it('wraps longitude before determining the sign', () => {
    expect(triplicityRulersAt(360 + 10)).toEqual(triplicityRulersAt(10));
  });
});

describe('triplicityRoleOf (#26)', () => {
  it('identifies the day, night and participating rulers of a fire sign', () => {
    const longitude = 10; // Aries
    expect(triplicityRoleOf(id('sun'), longitude)).toBe('day');
    expect(triplicityRoleOf(id('jupiter'), longitude)).toBe('night');
    expect(triplicityRoleOf(id('saturn'), longitude)).toBe('participating');
  });

  it('is undefined for a body with no triplicity role in that sign', () => {
    expect(triplicityRoleOf(id('mars'), 10)).toBeUndefined(); // Aries is fire; Mars has no fire triplicity role
  });
});
