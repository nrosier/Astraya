/**
 * Display names for the domain layer's stable astrological identifiers (#158): sign names,
 * `BodyDefinition.key`/the `'asc'`/`'mc'` pseudo-body keys, and `AspectDefinition.key`. Looked
 * up by that identifier rather than by editing it — `src/astrology/` and
 * `src/domain/chart-tables.ts` keep naming everything in English internally (those identifiers
 * drive logic, not just display); this is a pure UI-layer translation on top, shaped like every
 * other `*.messages.ts` catalogue so `test/i18n-messages.test.ts` covers it for free.
 *
 * Deliberately NOT covered here: `AngleRow`/`DerivedPointRow`'s compound technical labels (ARMC,
 * Vertex, the Equatorial/Polar Ascendant, the Co-Ascendant variants, the ASC/MC and Sun/Moon
 * midpoints, Part of Fortune/Spirit) — see the doc comments on `angleRows`/`derivedPointRows` in
 * `chart-tables.ts` for why.
 */
import type { Locale } from '../interpretation/schema.js';

const enSigns = {
  Aries: 'Aries',
  Taurus: 'Taurus',
  Gemini: 'Gemini',
  Cancer: 'Cancer',
  Leo: 'Leo',
  Virgo: 'Virgo',
  Libra: 'Libra',
  Scorpio: 'Scorpio',
  Sagittarius: 'Sagittarius',
  Capricorn: 'Capricorn',
  Aquarius: 'Aquarius',
  Pisces: 'Pisces',
};
const nlSigns: typeof enSigns = {
  Aries: 'Ram',
  Taurus: 'Stier',
  Gemini: 'Tweelingen',
  Cancer: 'Kreeft',
  Leo: 'Leeuw',
  Virgo: 'Maagd',
  Libra: 'Weegschaal',
  Scorpio: 'Schorpioen',
  Sagittarius: 'Boogschutter',
  Capricorn: 'Steenbok',
  Aquarius: 'Waterman',
  Pisces: 'Vissen',
};
export const signNamesMessages = { en: enSigns, nl: nlSigns };

const enBodies = {
  sun: 'Sun',
  moon: 'Moon',
  mercury: 'Mercury',
  venus: 'Venus',
  mars: 'Mars',
  jupiter: 'Jupiter',
  saturn: 'Saturn',
  uranus: 'Uranus',
  neptune: 'Neptune',
  pluto: 'Pluto',
  meanNode: 'Mean Node',
  trueNode: 'True Node',
  meanLilith: 'Mean Lilith',
  osculatingLilith: 'Osculating Lilith',
  interpolatedLilith: 'Interpolated Lilith',
  chiron: 'Chiron',
  ceres: 'Ceres',
  pallas: 'Pallas',
  juno: 'Juno',
  vesta: 'Vesta',
  asc: 'Ascendant',
  mc: 'Midheaven',
};
const nlBodies: typeof enBodies = {
  sun: 'Zon',
  moon: 'Maan',
  mercury: 'Mercurius',
  venus: 'Venus',
  mars: 'Mars',
  jupiter: 'Jupiter',
  saturn: 'Saturnus',
  uranus: 'Uranus',
  neptune: 'Neptunus',
  pluto: 'Pluto',
  meanNode: 'Gemiddelde Maansknoop',
  trueNode: 'Ware Maansknoop',
  meanLilith: 'Gemiddelde Lilith',
  osculatingLilith: 'Osculerende Lilith',
  interpolatedLilith: 'Geïnterpoleerde Lilith',
  chiron: 'Chiron',
  ceres: 'Ceres',
  pallas: 'Pallas',
  juno: 'Juno',
  vesta: 'Vesta',
  asc: 'Ascendant',
  mc: 'Hemelmidden',
};
export const bodyNamesMessages = { en: enBodies, nl: nlBodies };

const enAspects = {
  conjunction: 'Conjunction',
  semisextile: 'Semisextile',
  semisquare: 'Semisquare',
  sextile: 'Sextile',
  quintile: 'Quintile',
  square: 'Square',
  trine: 'Trine',
  sesquiquadrate: 'Sesquiquadrate',
  biquintile: 'Biquintile',
  quincunx: 'Quincunx',
  opposition: 'Opposition',
};
const nlAspects: typeof enAspects = {
  conjunction: 'Conjunctie',
  semisextile: 'Semisextiel',
  semisquare: 'Halfvierkant',
  sextile: 'Sextiel',
  quintile: 'Quintiel',
  square: 'Vierkant',
  trine: 'Driehoek',
  sesquiquadrate: 'Sesquiquadraat',
  biquintile: 'Biquintiel',
  quincunx: 'Quincunx',
  opposition: 'Oppositie',
};
export const aspectNamesMessages = { en: enAspects, nl: nlAspects };

function lookup(
  catalogue: Readonly<Record<Locale, Readonly<Record<string, string>>>>,
  key: string,
  locale: Locale,
): string {
  return catalogue[locale][key] ?? key;
}

/** Translates a `DegreeParts.sign` value (an English sign name, e.g. `'Aries'`). */
export function signDisplayName(sign: string, locale: Locale): string {
  return lookup(signNamesMessages, sign, locale);
}

/** Translates a `bodyKey`/`bodyAKey`/`bodyBKey` value (a `BodyDefinition.key`, or `'asc'`/`'mc'`). */
export function bodyDisplayName(bodyKey: string, locale: Locale): string {
  return lookup(bodyNamesMessages, bodyKey, locale);
}

/** Translates an `AspectRow.aspectKey` value (an `AspectDefinition.key`). */
export function aspectDisplayName(aspectKey: string, locale: Locale): string {
  return lookup(aspectNamesMessages, aspectKey, locale);
}
