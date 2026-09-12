/**
 * Property-based tests for invariants of the calculation core (#37).
 *
 * The example-based suites elsewhere (astrology-houses, astrology-ayanamsas,
 * astrology-bodies) pin specific dates and locations. These tests check the
 * same underlying invariants hold across many randomly generated epochs,
 * bodies, house systems, and locations, so a regression that only shows up
 * for an input nobody happened to hand-pick still gets caught.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { AYANAMSAS } from '../src/astrology/ayanamsas.js';
import { BODIES, bodyByKey, southNode } from '../src/astrology/bodies.js';
import { HOUSE_SYSTEMS } from '../src/astrology/houses.js';
import { arcsecondsBetween, getEngine } from './engine-harness.js';

// Random calendar dates within the shipped ephemeris range (1800-2399 CE, see
// engine.ts), well clear of both edges, with day capped at 28 so every
// month/day combination is valid.
const dateArb = fc.tuple(
  fc.integer({ min: 1801, max: 2398 }),
  fc.integer({ min: 1, max: 12 }),
  fc.integer({ min: 1, max: 28 }),
  fc.integer({ min: 0, max: 23 }),
);

const bodyIdArb = fc.constantFrom(...BODIES.map((b) => b.id));
const ayanamsaIdArb = fc.constantFrom(...AYANAMSAS.map((a) => a.id));

// Gauquelin sectors ('G') are numbered in the opposite rotational direction
// from every other system: verified by inspecting real output, its 36 cusps
// decrease around the circle rather than increase. That is a deliberate,
// documented convention (see houses.ts on 'G' being the cuspCount exception),
// not a bug, but it means the "forward and sums to 360" check below needs a
// direction to assume.
//
// The alternative Sunshine system ('i', sunshineAlt) is excluded for a
// different reason: it is Sun-relative, so its degeneracy latitude tracks the
// Sun's declination on the given date rather than being fixed like Placidus
// and Koch's ~66.5 degrees. Verified by sweeping latitude at two dates: at an
// equinox (low declination) even 75 degrees is fine, but near a solstice
// (declination close to its ~23.4 degree max) cusps start winding 3x at just
// under 59 degrees. Since this property test's dates range across the whole
// shipped epoch, no single latitude bound would be safe here without
// needlessly restricting the other systems, which don't have this issue.
// The original Sunshine system ('I') was checked under the same conditions
// and does not show it.
//
// The Horizon system ('H') is excluded for a third reason: its degenerate
// zone is not a fixed neighborhood around the equator, as originally
// thought, but tracks the RAMC for the given date and time — sweeping
// latitude at two dates found it winding 11x from just past latitude 0 out
// to roughly 10 degrees on one date, and from -0.1 to 0 (inclusive) but
// nowhere else, including the poles, on another. Since RAMC varies with
// every random date and hour this property test generates, no fixed
// latitude bound (unlike Placidus/Koch below) or small excluded
// neighborhood (unlike the near-zero case this test used to assume) can
// safely cover it, so 'H' is excluded outright rather than restricting the
// latitude range for every other system to accommodate it.
const EXCLUDED_HOUSE_SYSTEMS = new Set(['G', 'i', 'H']);
const houseSystemCodeArb = fc.constantFrom(
  ...HOUSE_SYSTEMS.filter((s) => !EXCLUDED_HOUSE_SYSTEMS.has(s.code)).map((s) => s.code),
);

// Placidus and Koch are undefined beyond roughly +/-66.5 degrees latitude
// (see the polar-fallback tests in astrology-houses.test.ts); staying well
// inside that keeps every system's `effectiveSystem` equal to the one asked
// for, which these properties depend on.
const safeLatitudeArb = fc.double({ min: -60, max: 60, noNaN: true });
const safeLongitudeArb = fc.double({ min: -179, max: 179, noNaN: true });

/** Forward arc from one ecliptic longitude to the next, always in [0, 360). */
function forwardArc(from: number, to: number): number {
  const diff = (to - from) % 360;
  return diff < 0 ? diff + 360 : diff;
}

/** Smallest angular separation between two longitudes, in [0, 180]. */
function angularDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

describe('house cusps wrap monotonically forward and sum to 360 degrees (#37)', () => {
  it('holds for every registered house system, across random epochs and locations', async () => {
    const engine = await getEngine();
    await fc.assert(
      fc.asyncProperty(
        dateArb,
        houseSystemCodeArb,
        safeLatitudeArb,
        safeLongitudeArb,
        async ([year, month, day, hour], code, latitude, longitude) => {
          const jd = await engine.julianDay(year, month, day, hour);
          const houses = await engine.houses(jd, { latitude, longitude, altitude: 0 }, code);
          const cusps = houses.cusps.slice(1); // index 0 is unused padding

          let total = 0;
          for (let i = 0; i < cusps.length; i += 1) {
            const from = cusps[i];
            const to = cusps[(i + 1) % cusps.length];
            if (from === undefined || to === undefined) throw new Error('test fixture bug: missing cusp');
            const arc = forwardArc(from, to);
            expect(arc, `${code} house ${i + 1}`).toBeGreaterThan(0);
            total += arc;
          }
          expect(total, code).toBeCloseTo(360, 6);
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe('the Ascendant sits at cusp 1 and the Midheaven at cusp 10, for quadrant systems (#37)', () => {
  // Verified empirically against a live engine, per this project's rule (see
  // houses.ts) that such facts are read off sweph-wasm rather than assumed:
  // of the 24 registered systems, exactly these are angle-anchored this way.
  const QUADRANT_CODES = ['B', 'C', 'G', 'I', 'i', 'K', 'L', 'O', 'P', 'Q', 'R', 'T', 'U', 'Y'];

  it('holds for every quadrant system, across random epochs and locations', async () => {
    const engine = await getEngine();
    await fc.assert(
      fc.asyncProperty(
        dateArb,
        fc.constantFrom(...QUADRANT_CODES),
        safeLatitudeArb,
        safeLongitudeArb,
        async ([year, month, day, hour], code, latitude, longitude) => {
          const jd = await engine.julianDay(year, month, day, hour);
          const houses = await engine.houses(jd, { latitude, longitude, altitude: 0 }, code);
          expect(houses.cusps[1], code).toBeCloseTo(houses.ascendant, 9);
          expect(houses.cusps[10], code).toBeCloseTo(houses.midheaven, 9);
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe('sidereal longitude equals tropical minus the ayanamsa (#37)', () => {
  it('holds for random bodies, epochs, and ayanamsa modes', async () => {
    const engine = await getEngine();
    await fc.assert(
      fc.asyncProperty(dateArb, bodyIdArb, ayanamsaIdArb, async ([year, month, day, hour], bodyId, ayanamsaId) => {
        const jd = await engine.julianDay(year, month, day, hour);
        const [tropical, sidereal, ayanamsa] = await Promise.all([
          engine.position(jd, bodyId),
          engine.position(jd, bodyId, { zodiac: { kind: 'sidereal', ayanamsa: ayanamsaId } }),
          engine.ayanamsa(jd, ayanamsaId),
        ]);
        // Angles, so compare wrapped rather than by raw value (some ayanamsa
        // values are reported outside [0, 360), e.g. negative). The bound is
        // arcseconds rather than the tighter tolerance the fixed-Sun example
        // test uses: verified directly against the engine, fixed-epoch modes
        // like j2000/j1900 combined with minor bodies (e.g. Pallas, osculating
        // Lilith) can diverge from a plain tropical-minus-ayanamsa subtraction
        // by several tens of arcseconds — a genuine property of sweph-wasm's
        // sidereal computation for those modes, not a bug in this codebase.
        // 90 arcseconds (1.5 arcminutes) comfortably covers the worst case
        // found (~60") while still catching a real regression, which would
        // be off by degrees.
        const delta = ((tropical.longitude - sidereal.longitude + 540) % 360) - 180;
        expect(arcsecondsBetween(delta, ayanamsa)).toBeLessThan(90);
      }),
      { numRuns: 25 },
    );
  });
});

describe('mean node plus 180 equals south node (#37)', () => {
  it('holds for any longitude, wrapping correctly across the 0/360 boundary', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 360, noNaN: true }), (longitude) => {
        const south = southNode(longitude);
        expect(south).toBeGreaterThanOrEqual(0);
        expect(south).toBeLessThan(360);
        expect(angularDistance(south, longitude)).toBeCloseTo(180, 9);
      }),
      { numRuns: 100 },
    );
  });

  it('holds for real mean-node positions from the engine, across random epochs', async () => {
    const engine = await getEngine();
    const meanNode = bodyByKey('meanNode');
    if (!meanNode) throw new Error('missing meanNode');
    await fc.assert(
      fc.asyncProperty(dateArb, async ([year, month, day, hour]) => {
        const jd = await engine.julianDay(year, month, day, hour);
        const north = await engine.position(jd, meanNode.id);
        const south = southNode(north.longitude);
        expect(angularDistance(south, north.longitude)).toBeCloseTo(180, 9);
      }),
      { numRuns: 20 },
    );
  });
});

describe('retrograde is exactly longitudeSpeed < 0 (#37)', () => {
  it('holds for random bodies and epochs', async () => {
    const engine = await getEngine();
    await fc.assert(
      fc.asyncProperty(dateArb, bodyIdArb, async ([year, month, day, hour], bodyId) => {
        const jd = await engine.julianDay(year, month, day, hour);
        const position = await engine.position(jd, bodyId);
        expect(position.retrograde).toBe(position.longitudeSpeed < 0);
      }),
      { numRuns: 30 },
    );
  });
});
