/**
 * Essential dignities: rulership, exaltation, detriment and fall (#25).
 *
 * Rulership comes in two schemes, selected explicitly rather than guessed:
 * `'traditional'` gives every sign a single classical ruler (Mars rules both
 * Aries and Scorpio, Saturn both Capricorn and Aquarius, Jupiter both
 * Sagittarius and Pisces); `'modern'` replaces the ruler of Scorpio, Aquarius
 * and Pisces with the outer planet discovered after those assignments were
 * fixed (Pluto, Uranus, Neptune respectively) and leaves the other nine signs
 * untouched. Nothing here silently mixes the two: a caller who wants modern
 * rulership must ask for it.
 *
 * Exaltation, detriment and fall are not scheme-dependent: the classical set
 * covers only the seven traditional planets and only seven of the twelve
 * signs (the other five have no traditionally-agreed exaltation), and no
 * modern-planet exaltation is added here since none is part of the shared
 * canon the way outer-planet rulership is.
 *
 * Detriment is defined as ruling the *opposite* sign; fall as being exalted
 * in the opposite sign. Both are derived from the tables above rather than
 * duplicated, so they can never drift out of sync with them.
 */
import { bodyByKey } from './bodies.js';
import type { BodyId, Degrees } from '../ephemeris/types.js';
import { oppositeSign, signIndex } from './signs.js';

export type RulershipScheme = 'traditional' | 'modern';

/** Indexed by sign (0 = Aries), the classical ruler's `BodyDefinition.key`. */
const TRADITIONAL_RULERS: readonly string[] = [
  'mars', // Aries
  'venus', // Taurus
  'mercury', // Gemini
  'moon', // Cancer
  'sun', // Leo
  'mercury', // Virgo
  'venus', // Libra
  'mars', // Scorpio
  'jupiter', // Sagittarius
  'saturn', // Capricorn
  'saturn', // Aquarius
  'jupiter', // Pisces
];

/** Signs whose modern ruler differs from the traditional one. */
const MODERN_RULER_OVERRIDES: Readonly<Record<number, string>> = {
  7: 'pluto', // Scorpio
  10: 'uranus', // Aquarius
  11: 'neptune', // Pisces
};

/** Indexed by sign, the exaltation ruler's key — absent where none is defined. */
const EXALTATION_RULERS: Readonly<Record<number, string>> = {
  0: 'sun', // Aries
  1: 'moon', // Taurus
  3: 'jupiter', // Cancer
  5: 'mercury', // Virgo
  6: 'saturn', // Libra
  9: 'mars', // Capricorn
  11: 'venus', // Pisces
};

function bodyKeyToId(key: string): BodyId {
  const body = bodyByKey(key);
  if (!body) throw new Error(`unreachable: body key "${key}" is not in the canonical body set`);
  return body.id;
}

/** The ruler of a sign under the given scheme. */
export function rulerOf(sign: number, scheme: RulershipScheme = 'traditional'): BodyId {
  const key = (scheme === 'modern' ? MODERN_RULER_OVERRIDES[sign] : undefined) ?? TRADITIONAL_RULERS[sign];
  if (key === undefined) throw new RangeError(`sign index ${sign} is outside [0, 11]`);
  return bodyKeyToId(key);
}

/** The exaltation ruler of a sign, or `undefined` for the five signs with none. */
export function exaltationRulerOf(sign: number): BodyId | undefined {
  const key = EXALTATION_RULERS[sign];
  return key === undefined ? undefined : bodyKeyToId(key);
}

/** The ruler of the sign in detriment here, i.e. the ruler of the opposite sign. */
export function detrimentRulerOf(sign: number, scheme: RulershipScheme = 'traditional'): BodyId {
  return rulerOf(oppositeSign(sign), scheme);
}

/** The ruler in fall here, i.e. the exaltation ruler of the opposite sign. */
export function fallRulerOf(sign: number): BodyId | undefined {
  return exaltationRulerOf(oppositeSign(sign));
}

export interface EssentialDignities {
  readonly ruler: boolean;
  readonly exalted: boolean;
  readonly detriment: boolean;
  readonly fall: boolean;
}

/**
 * Which essential dignities `body` holds at `longitude`. More than one can be
 * true at once under modern rulership only in the degenerate case of a scheme
 * with no shared signs between rulership and exaltation, which does not occur
 * here — but nothing in this function assumes otherwise, so a future table
 * change can't silently break it.
 */
export function essentialDignities(
  body: BodyId,
  longitude: Degrees,
  scheme: RulershipScheme = 'traditional',
): EssentialDignities {
  const sign = signIndex(longitude);
  return {
    ruler: rulerOf(sign, scheme) === body,
    exalted: exaltationRulerOf(sign) === body,
    detriment: detrimentRulerOf(sign, scheme) === body,
    fall: fallRulerOf(sign) === body,
  };
}
