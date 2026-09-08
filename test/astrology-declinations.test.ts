import { describe, expect, it } from 'vitest';
import {
  declinationContacts,
  isContraparallel,
  isOutOfBounds,
  isParallel,
  outOfBoundsBodies,
} from '../src/astrology/declinations.js';

describe('isParallel (#32)', () => {
  it('is true for equal declinations', () => {
    expect(isParallel(20, 20, 1)).toBe(true);
  });

  it('is true within orb for the same hemisphere', () => {
    expect(isParallel(20, 20.5, 1)).toBe(true);
  });

  it('is false outside orb', () => {
    expect(isParallel(20, 22, 1)).toBe(false);
  });

  it('is false across hemispheres even at equal magnitude', () => {
    expect(isParallel(20, -20, 1)).toBe(false);
  });
});

describe('isContraparallel (#32)', () => {
  it('is true for equal magnitude, opposite hemisphere', () => {
    expect(isContraparallel(20, -20, 1)).toBe(true);
  });

  it('is true within orb', () => {
    expect(isContraparallel(20, -19.5, 1)).toBe(true);
  });

  it('is false outside orb', () => {
    expect(isContraparallel(20, -17, 1)).toBe(false);
  });

  it('is false for the same hemisphere', () => {
    expect(isContraparallel(20, 20, 1)).toBe(false);
  });
});

describe('isOutOfBounds (#32)', () => {
  const obliquity = 23.44;

  it('is false for a declination within the tropics', () => {
    expect(isOutOfBounds(20, obliquity)).toBe(false);
  });

  it('is true for a declination beyond the obliquity, either hemisphere', () => {
    expect(isOutOfBounds(24, obliquity)).toBe(true);
    expect(isOutOfBounds(-24, obliquity)).toBe(true);
  });

  it('is false exactly at the boundary', () => {
    expect(isOutOfBounds(obliquity, obliquity)).toBe(false);
  });
});

describe('declinationContacts (#32)', () => {
  it('finds a parallel and a contraparallel pair, and excludes an unrelated body', () => {
    const declinations = new Map([
      [0, 20], // sun
      [1, 20.2], // moon: parallel to the sun
      [2, -19.8], // mercury: contraparallel to the sun
      [3, 5], // venus: unrelated
    ]);
    const contacts = declinationContacts(declinations, 1);
    expect(contacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ a: 0, b: 1, kind: 'parallel' }),
        expect.objectContaining({ a: 0, b: 2, kind: 'contraparallel' }),
      ]),
    );
    expect(contacts.some((contact) => contact.a === 3 || contact.b === 3)).toBe(false);
  });

  it('omits contacts outside the given orb', () => {
    const declinations = new Map([
      [0, 20],
      [1, 5],
    ]);
    expect(declinationContacts(declinations, 1)).toHaveLength(0);
  });
});

describe('outOfBoundsBodies (#32)', () => {
  it('returns only the bodies beyond the obliquity', () => {
    const declinations = new Map([
      [0, 20],
      [1, 25],
      [2, -26],
    ]);
    const result = outOfBoundsBodies(declinations, 23.44);
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ body: 1 }), expect.objectContaining({ body: 2 })]),
    );
    expect(result.some((entry) => entry.body === 0)).toBe(false);
  });
});
