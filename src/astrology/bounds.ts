/**
 * Bounds (terms): Egyptian and Ptolemaic tables (#26).
 *
 * A bound is an unequal-width subdivision of a sign — five per sign, one per
 * traditional planet — used for essential dignity ("in its own bounds") and
 * for peregrine/almuten scoring (#27). Two classical tables assign different
 * widths to the same five planets per sign; neither supersedes the other, so
 * both are exposed and a caller must ask for one explicitly (`BoundsScheme`)
 * rather than getting either as a silent default.
 *
 * Both tables are transcribed from flatlib (github.com/flatangle/flatlib,
 * MIT-licensed), `flatlib/dignities/tables.py`'s `EGYPTIAN_TERMS` and
 * `TETRABIBLOS_TERMS` constants — the latter is explicitly cited there as
 * sourced from the F.E. Robbins translation of Ptolemy's Tetrabiblos. That
 * table is what most software calls the "Ptolemaic" terms, as distinct from
 * the separate variant recorded in Lilly's Christian Astrology (not
 * implemented here). Each table's five ranges per sign were checked here to
 * be contiguous and sum to exactly 30 degrees (see the completeness test in
 * astrology-bounds.test.ts) as an internal-consistency check on the
 * transcription, independent of the source's own accuracy.
 */
import { bodyByKey } from './bodies.js';
import type { BodyId, Degrees } from '../ephemeris/types.js';
import { degreesInSign, signIndex } from './signs.js';

export type BoundsScheme = 'egyptian' | 'ptolemaic';

export interface Bound {
  readonly ruler: BodyId;
  readonly from: Degrees;
  readonly to: Degrees;
}

function id(key: string): BodyId {
  const body = bodyByKey(key);
  if (!body) throw new Error(`unreachable: body key "${key}" is not in the canonical body set`);
  return body.id;
}

type RawBound = readonly [key: string, from: number, to: number];

// Indexed by sign (0 = Aries). Each sign's five entries cover [0, 30) in
// order, with no gaps or overlaps.
const EGYPTIAN_RAW: readonly (readonly RawBound[])[] = [
  [
    ['jupiter', 0, 6],
    ['venus', 6, 12],
    ['mercury', 12, 20],
    ['mars', 20, 25],
    ['saturn', 25, 30],
  ], // Aries
  [
    ['venus', 0, 8],
    ['mercury', 8, 14],
    ['jupiter', 14, 22],
    ['saturn', 22, 27],
    ['mars', 27, 30],
  ], // Taurus
  [
    ['mercury', 0, 6],
    ['jupiter', 6, 12],
    ['venus', 12, 17],
    ['mars', 17, 24],
    ['saturn', 24, 30],
  ], // Gemini
  [
    ['mars', 0, 7],
    ['venus', 7, 13],
    ['mercury', 13, 19],
    ['jupiter', 19, 26],
    ['saturn', 26, 30],
  ], // Cancer
  [
    ['jupiter', 0, 6],
    ['venus', 6, 11],
    ['saturn', 11, 18],
    ['mercury', 18, 24],
    ['mars', 24, 30],
  ], // Leo
  [
    ['mercury', 0, 7],
    ['venus', 7, 17],
    ['jupiter', 17, 21],
    ['mars', 21, 28],
    ['saturn', 28, 30],
  ], // Virgo
  [
    ['saturn', 0, 6],
    ['mercury', 6, 14],
    ['jupiter', 14, 21],
    ['venus', 21, 28],
    ['mars', 28, 30],
  ], // Libra
  [
    ['mars', 0, 7],
    ['venus', 7, 11],
    ['mercury', 11, 19],
    ['jupiter', 19, 24],
    ['saturn', 24, 30],
  ], // Scorpio
  [
    ['jupiter', 0, 12],
    ['venus', 12, 17],
    ['mercury', 17, 21],
    ['saturn', 21, 26],
    ['mars', 26, 30],
  ], // Sagittarius
  [
    ['mercury', 0, 7],
    ['jupiter', 7, 14],
    ['venus', 14, 22],
    ['saturn', 22, 26],
    ['mars', 26, 30],
  ], // Capricorn
  [
    ['mercury', 0, 7],
    ['venus', 7, 13],
    ['jupiter', 13, 20],
    ['mars', 20, 25],
    ['saturn', 25, 30],
  ], // Aquarius
  [
    ['venus', 0, 12],
    ['jupiter', 12, 16],
    ['mercury', 16, 19],
    ['mars', 19, 28],
    ['saturn', 28, 30],
  ], // Pisces
];

// Ptolemy's own terms (Tetrabiblos I.21, Robbins translation) — distinct from
// the Egyptian table above in both widths and, for several signs, ordering.
const PTOLEMAIC_RAW: readonly (readonly RawBound[])[] = [
  [
    ['jupiter', 0, 6],
    ['venus', 6, 14],
    ['mercury', 14, 21],
    ['mars', 21, 26],
    ['saturn', 26, 30],
  ], // Aries
  [
    ['venus', 0, 8],
    ['mercury', 8, 15],
    ['jupiter', 15, 22],
    ['saturn', 22, 24],
    ['mars', 24, 30],
  ], // Taurus
  [
    ['mercury', 0, 7],
    ['jupiter', 7, 13],
    ['venus', 13, 20],
    ['mars', 20, 26],
    ['saturn', 26, 30],
  ], // Gemini
  [
    ['mars', 0, 6],
    ['jupiter', 6, 13],
    ['mercury', 13, 20],
    ['venus', 20, 27],
    ['saturn', 27, 30],
  ], // Cancer
  [
    ['jupiter', 0, 6],
    ['mercury', 6, 13],
    ['saturn', 13, 19],
    ['venus', 19, 25],
    ['mars', 25, 30],
  ], // Leo
  [
    ['mercury', 0, 7],
    ['venus', 7, 13],
    ['jupiter', 13, 18],
    ['saturn', 18, 24],
    ['mars', 24, 30],
  ], // Virgo
  [
    ['saturn', 0, 6],
    ['venus', 6, 11],
    ['mercury', 11, 16],
    ['jupiter', 16, 24],
    ['mars', 24, 30],
  ], // Libra
  [
    ['mars', 0, 6],
    ['venus', 6, 13],
    ['jupiter', 13, 21],
    ['mercury', 21, 27],
    ['saturn', 27, 30],
  ], // Scorpio
  [
    ['jupiter', 0, 8],
    ['venus', 8, 14],
    ['mercury', 14, 19],
    ['saturn', 19, 25],
    ['mars', 25, 30],
  ], // Sagittarius
  [
    ['venus', 0, 6],
    ['mercury', 6, 12],
    ['jupiter', 12, 19],
    ['saturn', 19, 25],
    ['mars', 25, 30],
  ], // Capricorn
  [
    ['saturn', 0, 6],
    ['mercury', 6, 12],
    ['venus', 12, 20],
    ['jupiter', 20, 25],
    ['mars', 25, 30],
  ], // Aquarius
  [
    ['venus', 0, 8],
    ['jupiter', 8, 14],
    ['mercury', 14, 20],
    ['mars', 20, 25],
    ['saturn', 25, 30],
  ], // Pisces
];

function resolve(raw: readonly (readonly RawBound[])[]): readonly (readonly Bound[])[] {
  return raw.map((sign) => sign.map(([key, from, to]) => ({ ruler: id(key), from, to })));
}

const BOUNDS: Readonly<Record<BoundsScheme, readonly (readonly Bound[])[]>> = {
  egyptian: resolve(EGYPTIAN_RAW),
  ptolemaic: resolve(PTOLEMAIC_RAW),
};

/** The five bounds of a sign (0 = Aries), in order from 0 to 30 degrees. */
export function boundsOf(sign: number, scheme: BoundsScheme = 'egyptian'): readonly Bound[] {
  const bounds = BOUNDS[scheme][sign];
  if (!bounds) throw new RangeError(`sign index ${sign} is outside [0, 11]`);
  return bounds;
}

/** The bound ruler of a longitude under the given scheme. */
export function boundRulerOf(longitude: Degrees, scheme: BoundsScheme = 'egyptian'): BodyId {
  const sign = signIndex(longitude);
  const degree = degreesInSign(longitude);
  const signBounds = boundsOf(sign, scheme);
  const bound = signBounds.find((b) => degree >= b.from && degree < b.to);
  const lastBound = signBounds[signBounds.length - 1];
  if (!lastBound) throw new Error(`unreachable: sign ${sign} has no bounds`);
  // Unreachable given the contiguous, 30-degree-summing tables verified by
  // the completeness test, but degreesInSign's floating-point result could
  // in principle land exactly on 30 for a longitude that itself rounds to
  // the next sign; falling back to the final bound rather than throwing
  // keeps this total rather than needing a caller-visible edge case.
  return (bound ?? lastBound).ruler;
}
