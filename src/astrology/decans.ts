/**
 * Decans (faces): Chaldean order and triplicity assignment (#26).
 *
 * A decan is a third of a sign, 10 degrees wide — 36 in the full zodiac. Two
 * independent, unrelated schemes assign each one a ruling planet:
 *
 * - The Chaldean "faces": starting from Aries' first decan, the seven
 *   traditional planets repeat in the Chaldean order (Saturn, Jupiter, Mars,
 *   Sun, Venus, Mercury, Moon) — but the cycle happens to start mid-sequence,
 *   at Mars, because that is where it lands for Aries. Verified against the
 *   published table (Lilly's "Faces of the Planets"): Aries is Mars, Sun,
 *   Venus; Taurus continues Mercury, Moon, Saturn, and so on with no reset at
 *   sign boundaries — the 7-planet cycle runs straight through all 36 decans.
 * - The triplicity (sign-based) decans: each decan is "ruled" by a sign
 *   rather than a planet directly — the sign itself, then the next sign of
 *   the same triplicity, then the third, cycling from wherever the starting
 *   sign sits in its triplicity. The planet most people mean when they ask
 *   "who rules this decan" under this scheme is that sign's own domicile
 *   ruler (traditional scheme; the system predates the outer planets), so
 *   this module returns that planet directly rather than an intermediate
 *   sign the caller would have to look up rulership for anyway.
 */
import { bodyByKey } from './bodies.js';
import type { BodyId, Degrees } from '../ephemeris/types.js';
import { rulerOf } from './dignities.js';
import type { Element } from './signs.js';
import { SIGNS, SIGN_SPAN, degreesInSign, signIndex } from './signs.js';

function id(key: string): BodyId {
  const body = bodyByKey(key);
  if (!body) throw new Error(`unreachable: body key "${key}" is not in the canonical body set`);
  return body.id;
}

/** The width of one decan. */
export const DECAN_SPAN: Degrees = SIGN_SPAN / 3;

/** The Chaldean order, starting at Mars — where it happens to land for Aries. */
const CHALDEAN_ORDER: readonly BodyId[] = [
  id('mars'),
  id('sun'),
  id('venus'),
  id('mercury'),
  id('moon'),
  id('saturn'),
  id('jupiter'),
];

/** The zero-based decan index (0..35) for a longitude, wrapping first. */
export function decanIndex(longitude: Degrees): number {
  return signIndex(longitude) * 3 + Math.floor(degreesInSign(longitude) / DECAN_SPAN);
}

/** Which decan (0, 1 or 2) within its sign a longitude falls in. */
export function decanInSign(longitude: Degrees): 0 | 1 | 2 {
  return Math.floor(degreesInSign(longitude) / DECAN_SPAN) as 0 | 1 | 2;
}

/** The Chaldean face ruler of a longitude. */
export function faceRulerOf(longitude: Degrees): BodyId {
  const ruler = CHALDEAN_ORDER[decanIndex(longitude) % 7];
  if (ruler === undefined) throw new Error(`unreachable: decan index out of range for ${longitude}`);
  return ruler;
}

/** The three signs of an element's triplicity, in zodiacal order. */
const TRIPLICITY_SIGNS: Readonly<Record<Element, readonly [number, number, number]>> = {
  fire: [0, 4, 8],
  earth: [1, 5, 9],
  air: [2, 6, 10],
  water: [3, 7, 11],
};

/**
 * The triplicity decan ruler of a longitude: the domicile ruler of the sign
 * that decan is assigned to under the sign-based (triplicity) decan scheme —
 * the sign itself for the first decan, then the next and third signs of its
 * triplicity, cycling from wherever the sign sits within it.
 */
export function triplicityDecanRulerOf(longitude: Degrees): BodyId {
  const sign = signIndex(longitude);
  const definition = SIGNS[sign];
  if (!definition) throw new Error(`unreachable: sign index ${sign} out of range`);
  const members = TRIPLICITY_SIGNS[definition.element];
  const position = members.indexOf(sign);
  if (position === -1) throw new Error(`unreachable: sign ${sign} missing from its own triplicity`);
  const targetSign = members[(position + decanInSign(longitude)) % 3];
  if (targetSign === undefined) throw new Error(`unreachable: triplicity index out of range for sign ${sign}`);
  return rulerOf(targetSign, 'traditional');
}
