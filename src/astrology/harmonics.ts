/**
 * Harmonic charts and Vedic Varga (divisional) charts (#170).
 *
 * The general mechanism behind both is the same: multiply every longitude by a whole number `n`
 * and wrap it back into 0-360. A harmonic chart exposes `n` directly (the classic "fifth
 * harmonic", "seventh harmonic", etc. of harmonic-chart astrology); a Varga chart is the same
 * multiplication under a Vedic name, with `n` fixed by which division the name refers to (D9 is
 * n=9, D10 is n=10, and so on) — see `VARGA_PRESETS` below, which is deliberately just a named
 * table over the one general function rather than a second calculation path.
 *
 * Convention note, since the issue explicitly asks for one (Vedic sources disagree on
 * sign-counting rules, especially for D9): this module uses the single continuous rule
 * `longitude * n mod 360` for every division, including the named Vedic presets. For D9
 * Navamsha this is not a simplification — `longitude * 9 mod 360` lands in exactly the sign the
 * classical Parashari navamsha rule gives, at every sign boundary, because a 30-degree natal sign
 * times 9 spans exactly 270 degrees, i.e. nine navamsha signs starting from a fixed point that
 * depends only on the natal sign's own modality (movable/fixed/mutable) in a way the plain
 * multiplication already reproduces.
 *
 * For D10 Dashamsha, though, this *is* a simplification, and a deliberate one: several classical
 * sources compute D10 by counting nine dashamsha divisions from the natal sign for planets in an
 * odd sign, but restarting the count nine signs further round (i.e. from the sign itself rather
 * than the next one) for planets in an even sign. That odd/even restart is a second, distinct
 * rule bolted onto the general harmonic mechanism, not a consequence of it — this module does not
 * implement it, and instead uses the same continuous `n=10` multiplication as every other
 * division, so that "Vedic preset" always means "a name for one value of the one general
 * mechanism" with no hidden per-chart special case. A reader who wants the odd/even D10 convention
 * instead should treat this chart's D10 as an approximation and check a source that states which
 * convention it follows, exactly as this comment does.
 */
import { SIGN_SPAN, signIndex } from './signs.js';
import type { BodyPosition, Degrees, HousePositions } from '../ephemeris/types.js';

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** The general harmonic/Varga mechanism: `longitude * n`, wrapped back into 0-360. */
export function harmonicLongitude(longitude: Degrees, n: number): Degrees {
  return norm360(longitude * n);
}

/**
 * A body's harmonic position. Only longitude is transformed — latitude, distance and every speed
 * are carried over unchanged from the natal position, and so is `retrograde`: a harmonic chart is
 * a relabelling of where a body sits on the zodiac, not a second, faster-moving body, so whether
 * it is really moving backwards in the sky is a fact this transform has no business overriding.
 */
export function harmonicPosition(natal: BodyPosition, n: number): BodyPosition {
  return { ...natal, longitude: harmonicLongitude(natal.longitude, n) };
}

/**
 * Whole-sign houses for a harmonic/Varga chart, built purely arithmetically from the natal
 * houses — no ephemeris call. Whole-sign is the only house system whose cusps stay well-defined
 * after a "multiply longitude by n" transform (a Placidus or Koch cusp multiplied by n has no
 * astrological meaning; a whole-sign cusp derived from a multiplied Ascendant is self-consistent
 * with what whole-sign already means), and it is also the conventional house system for Vedic
 * Varga practice, so both reasons point the same way.
 *
 * The Ascendant is transformed like any other point; the sign it lands in becomes house 1, and
 * the remaining eleven cusps are the following signs' zeroth degree, 30 degrees apart. Every
 * other angle (`midheaven`, `armc`, `vertex`, `equatorialAscendant`, both co-ascendants,
 * `polarAscendant`) is transformed the same way as a body's longitude, for a single uniform rule
 * rather than a special case per field — several of these (`armc` especially) are not ecliptic
 * longitudes in the natal chart, so this is a documented simplification, not a claim that the
 * result is independently meaningful the way the transformed Ascendant and cusps are.
 */
export function harmonicHouses(natal: HousePositions, n: number): HousePositions {
  const ascendant = harmonicLongitude(natal.ascendant, n);
  const baseSign = signIndex(ascendant);
  const cusps: Degrees[] = [Number.NaN];
  for (let house = 1; house <= 12; house++) {
    cusps.push(norm360((baseSign + house - 1) * SIGN_SPAN));
  }

  return {
    cusps,
    ascendant,
    midheaven: harmonicLongitude(natal.midheaven, n),
    armc: harmonicLongitude(natal.armc, n),
    vertex: harmonicLongitude(natal.vertex, n),
    equatorialAscendant: harmonicLongitude(natal.equatorialAscendant, n),
    coAscendantKoch: harmonicLongitude(natal.coAscendantKoch, n),
    coAscendantMunkasey: harmonicLongitude(natal.coAscendantMunkasey, n),
    polarAscendant: harmonicLongitude(natal.polarAscendant, n),
    system: 'W',
  };
}

export interface HarmonicPreset {
  readonly key: string;
  readonly label: string;
  readonly n: number;
  readonly description: string;
}

/**
 * Named Vedic Varga presets, on top of the general harmonic mechanism above. Listed here rather
 * than scattered across the UI so the whole table — and its shared convention note — stays in one
 * place. The issue asks for D9 and D10 "at minimum"; both are included, plus D1 (the natal chart
 * itself, n=1) as the trivial case a selector needs to offer alongside them.
 */
export const VARGA_PRESETS: readonly HarmonicPreset[] = [
  { key: 'D1', label: 'D1 — Rashi (natal)', n: 1, description: 'The natal chart itself; the trivial harmonic.' },
  {
    key: 'D9',
    label: 'D9 — Navamsha',
    n: 9,
    description:
      'Marriage and inner strength. This module’s continuous rule matches the classical Parashari result exactly.',
  },
  {
    key: 'D10',
    label: 'D10 — Dashamsha',
    n: 10,
    description:
      'Career and public life. Uses the continuous n=10 rule, not the classical odd/even sign restart — see this module’s doc comment.',
  },
];
