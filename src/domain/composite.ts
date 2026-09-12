/**
 * Computes a composite (midpoint) chart from two people's natal charts (#169).
 *
 * A composite chart is a synthetic third chart, not a comparison between two existing ones —
 * that's synastry, #172. Every body's composite position is the near-arc midpoint (#30's
 * `midpointOf`: half of the *shorter* arc, Ebertin's convention, not the naive `(a+b)/2`)
 * between that body's longitude in each natal chart.
 *
 * Composite houses use the classic "midpoint of cusps" method: every cusp, the Ascendant, MC
 * and every other angle is the near-arc midpoint of the corresponding angle in each natal
 * chart's own `HousePositions` — arithmetic only, no ephemeris call, in the same shape
 * `progressions.ts`'s `shiftHouses` already uses to build a new `HousePositions` by
 * transforming an existing one rather than recomputing from a Julian day. The alternative,
 * time/space-midpoint "Davison" method — averaging the two birth moments and places into one
 * real moment and asking the ephemeris for its houses — is a different technique and this
 * issue's own explicit non-goal: there is no single Julian day here to hand `provider.houses`.
 *
 * Every other field (the composite's own aspects, dignities, sect, and the two Arabic parts) is
 * then computed fresh from the composite's midpoint positions and houses, exactly as
 * `computeChartDataAtJd` computes them for a real chart — a composite is not a comparison, so
 * it needs the single-chart `findAspects`, not the cross-chart engine synastry/transit use.
 */
import { DEFAULT_ORB_CONFIG, findAspects, subjectsFrom, type Aspect, type OrbConfig } from '../astrology/aspects.js';
import { bodyByKey, bodyById, type BodyCategory } from '../astrology/bodies.js';
import { essentialDignities, type EssentialDignities } from '../astrology/dignities.js';
import { partOfFortune, partOfSpirit } from '../astrology/arabic-parts.js';
import { midpointOf } from '../astrology/midpoints.js';
import { sectOf, type Sect } from '../astrology/sect.js';
import { computeChartData, type ChartCalculationOptions, type ChartData } from './chart-compute.js';
import type { BodyId, BodyPosition, EphemerisProvider, HousePositions } from '../ephemeris/types.js';
import type { BirthMomentInput } from '../time/types.js';

function categoryOf(body: BodyId): BodyCategory {
  const definition = bodyById(body);
  if (definition === undefined) throw new Error(`unreachable: ${String(body)} is always one of BODIES`);
  return definition.category;
}

/** Whether `body` participates in the composite's own aspect-finding, per `aspectsTo` — same three families `computeChartDataAtJd` excludes by default. */
function isAspectEligible(body: BodyId, aspectsTo: ChartCalculationOptions['aspectsTo']): boolean {
  const definition = bodyById(body);
  if (definition === undefined) return true;
  if (definition.category === 'centaur') return aspectsTo?.chiron === true;
  if (definition.category === 'lilith') return aspectsTo?.lilith === true;
  if (definition.category === 'node') return aspectsTo?.lunarNodes === true;
  return true;
}

/** Near-arc midpoint of every corresponding field in two `HousePositions` — see this module's doc comment. */
function midpointHouses(a: HousePositions, b: HousePositions): HousePositions {
  return {
    cusps: a.cusps.map((cusp, index) => {
      const other = b.cusps[index];
      return other === undefined ? cusp : midpointOf(cusp, other);
    }),
    ascendant: midpointOf(a.ascendant, b.ascendant),
    midheaven: midpointOf(a.midheaven, b.midheaven),
    armc: midpointOf(a.armc, b.armc),
    vertex: midpointOf(a.vertex, b.vertex),
    equatorialAscendant: midpointOf(a.equatorialAscendant, b.equatorialAscendant),
    coAscendantKoch: midpointOf(a.coAscendantKoch, b.coAscendantKoch),
    coAscendantMunkasey: midpointOf(a.coAscendantMunkasey, b.coAscendantMunkasey),
    polarAscendant: midpointOf(a.polarAscendant, b.polarAscendant),
    system: a.system,
  };
}

/**
 * Near-arc midpoint of every field in two `BodyPosition`s for the same body. Longitude uses the
 * near-arc convention (`midpointOf`); latitude, distance and every speed are plain, non-circular
 * averages. `retrograde` is re-derived from the composite's own midpoint speed rather than
 * averaged as a boolean, since "half-retrograde" is meaningless.
 */
function midpointPosition(a: BodyPosition, b: BodyPosition): BodyPosition {
  const longitudeSpeed = (a.longitudeSpeed + b.longitudeSpeed) / 2;
  return {
    body: a.body,
    longitude: midpointOf(a.longitude, b.longitude),
    latitude: (a.latitude + b.latitude) / 2,
    distance: (a.distance + b.distance) / 2,
    longitudeSpeed,
    latitudeSpeed: (a.latitudeSpeed + b.latitudeSpeed) / 2,
    distanceSpeed: (a.distanceSpeed + b.distanceSpeed) / 2,
    retrograde: longitudeSpeed < 0,
  };
}

export interface CompositeData {
  readonly chartA: ChartData;
  readonly chartB: ChartData;
  /**
   * The synthetic composite chart itself: midpoint positions, midpoint-of-cusps houses, and its
   * own aspects, dignities, sect and Arabic parts, computed fresh from those.
   */
  readonly composite: ChartData;
}

/** `provider` must already be initialized. Both moments are resolved and computed independently. */
export async function computeComposite(
  momentA: BirthMomentInput,
  momentB: BirthMomentInput,
  provider: EphemerisProvider,
  options: ChartCalculationOptions = {},
  orbConfig?: OrbConfig,
): Promise<CompositeData> {
  const [chartA, chartB] = await Promise.all([
    computeChartData(momentA, provider, options),
    computeChartData(momentB, provider, options),
  ]);

  const positionsByBodyB = new Map(chartB.positions.map((position) => [position.body, position]));
  const positions: BodyPosition[] = [];
  for (const positionA of chartA.positions) {
    const positionB = positionsByBodyB.get(positionA.body);
    if (positionB === undefined) continue;
    positions.push(midpointPosition(positionA, positionB));
  }

  const houses = midpointHouses(chartA.houses, chartB.houses);

  const eligiblePositions = positions.filter((position) => isAspectEligible(position.body, options.aspectsTo));
  const aspects: readonly Aspect[] = findAspects(
    subjectsFrom(eligiblePositions, categoryOf),
    orbConfig ?? DEFAULT_ORB_CONFIG,
  );

  const dignities = new Map<BodyId, EssentialDignities>(
    positions.map((position) => [position.body, essentialDignities(position.body, position.longitude)]),
  );

  const sun = bodyByKey('sun');
  const moon = bodyByKey('moon');
  if (sun === undefined || moon === undefined) throw new Error('unreachable: sun/moon are always in BODIES');
  const positionByBody = new Map(positions.map((position) => [position.body, position]));
  const sunPosition = positionByBody.get(sun.id);
  const moonPosition = positionByBody.get(moon.id);
  if (sunPosition === undefined || moonPosition === undefined) {
    throw new Error('unreachable: both charts always carry a Sun and Moon position');
  }

  const sect: Sect = sectOf(sunPosition.longitude, houses.ascendant);

  const composite: ChartData = {
    positions,
    houses,
    aspects,
    dignities,
    sect,
    partOfFortune: partOfFortune(sect, houses.ascendant, sunPosition.longitude, moonPosition.longitude),
    partOfSpirit: partOfSpirit(sect, houses.ascendant, sunPosition.longitude, moonPosition.longitude),
  };

  return { chartA, chartB, composite };
}
