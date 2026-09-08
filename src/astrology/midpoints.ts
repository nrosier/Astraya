/**
 * Midpoints, midpoint trees, and the 90-degree dial (#30).
 *
 * Two points on a circle have two midpoints, 180 degrees apart. The one
 * conventionally meant — Ebertin's cosmobiology, and every midpoint table
 * since — is the near one: half of the *shorter* arc between them, not the
 * naive `(a+b)/2` (which lands on whichever arc contains longitude 0, an
 * accident of where the zodiac happens to start counting).
 *
 * The 90-degree dial is what makes a midpoint *tree* practical: projecting
 * every longitude onto a quarter-circle (`longitude mod 90`) collapses
 * conjunction, square, and opposition to the same dial position, so a
 * single distance check catches a body in any hard aspect to a midpoint,
 * not only an exact conjunction.
 */
import type { BodyId, Degrees } from '../ephemeris/types.js';

function norm360(degrees: Degrees): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

/** The midpoint on the shorter arc between two longitudes. */
export function midpointOf(a: Degrees, b: Degrees): Degrees {
  const diff = norm360(b - a);
  const half = diff <= 180 ? diff / 2 : diff / 2 - 180;
  return norm360(a + half);
}

/** The far-arc midpoint: the near midpoint's antipode. */
export function oppositeMidpointOf(a: Degrees, b: Degrees): Degrees {
  return norm360(midpointOf(a, b) + 180);
}

export interface BodyPairMidpoint {
  readonly a: BodyId;
  readonly b: BodyId;
  readonly midpoint: Degrees;
}

/** Every unique body-pair midpoint among the given positions. */
export function allMidpoints(positions: ReadonlyMap<BodyId, Degrees>): readonly BodyPairMidpoint[] {
  const entries = Array.from(positions.entries());
  const result: BodyPairMidpoint[] = [];
  for (const [i, [a, longitudeA]] of entries.entries()) {
    for (const [b, longitudeB] of entries.slice(i + 1)) {
      result.push({ a, b, midpoint: midpointOf(longitudeA, longitudeB) });
    }
  }
  return result;
}

/** Projects a longitude onto the 90-degree dial: 0/90/180/270 all land at the same dial position. */
export function dialPosition(longitude: Degrees): Degrees {
  return norm360(longitude) % 90;
}

/** Shortest distance between two dial positions, wrapping at the 0/90 seam. */
function dialSeparation(a: Degrees, b: Degrees): Degrees {
  const diff = Math.abs(dialPosition(a) - dialPosition(b));
  return Math.min(diff, 90 - diff);
}

export interface MidpointTreeHit extends BodyPairMidpoint {
  readonly body: BodyId;
  /** Dial-position separation between `body` and this pair's midpoint. */
  readonly orb: Degrees;
}

/**
 * Every body that falls, on the 90-degree dial and within `orb`, on some
 * other pair's midpoint. A dial hit means a hard aspect (conjunction,
 * square, or opposition) to that midpoint — the traditional midpoint tree.
 */
export function midpointTree(positions: ReadonlyMap<BodyId, Degrees>, orb: Degrees): readonly MidpointTreeHit[] {
  const pairs = allMidpoints(positions);
  const hits: MidpointTreeHit[] = [];
  for (const [body, longitude] of positions) {
    for (const pair of pairs) {
      if (pair.a === body || pair.b === body) continue;
      const separation = dialSeparation(longitude, pair.midpoint);
      if (separation <= orb) hits.push({ ...pair, body, orb: separation });
    }
  }
  return hits;
}
