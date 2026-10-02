/**
 * Computes a draconic chart from one person's natal chart (#398).
 *
 * Like harmonic/Varga charts, a draconic chart is synthetic rather than a comparison, so this
 * reuses the single-chart engine (`findAspects`, `essentialDignities`, `sectOf`, the two Arabic
 * parts) to compute fresh aspects/dignities/sect/parts from the transformed positions — exactly
 * the way `computeHarmonic` does. Unlike harmonic, houses are not transformed at all: the natal
 * `HousePositions` carries through unchanged (see `draconic.ts`'s own doc comment for why), which
 * also means `sect`/the Arabic parts below use the natal Ascendant, as intended — one Ascendant,
 * two position sets.
 */
import { DEFAULT_ORB_CONFIG, findAspects, subjectsFrom, type Aspect, type OrbConfig } from '../astrology/aspects.js';
import { bodyByKey, bodyById, type BodyCategory } from '../astrology/bodies.js';
import { essentialDignities, type EssentialDignities } from '../astrology/dignities.js';
import { partOfFortune, partOfSpirit } from '../astrology/arabic-parts.js';
import { draconicPosition } from '../astrology/draconic.js';
import { sectOf, type Sect } from '../astrology/sect.js';
import { computeChartData, type ChartCalculationOptions, type ChartData } from './chart-compute.js';
import type { BodyId, BodyPosition, EphemerisProvider } from '../ephemeris/types.js';
import type { BirthMomentInput } from '../time/types.js';

function categoryOf(body: BodyId): BodyCategory {
  const definition = bodyById(body);
  if (definition === undefined) throw new Error(`unreachable: ${String(body)} is always one of BODIES`);
  return definition.category;
}

/** Same three families `computeChartDataAtJd` excludes by default — see its own doc comment. */
function isAspectEligible(body: BodyId, aspectsTo: ChartCalculationOptions['aspectsTo']): boolean {
  const definition = bodyById(body);
  if (definition === undefined) return true;
  if (definition.category === 'centaur') return aspectsTo?.chiron === true;
  if (definition.category === 'lilith') return aspectsTo?.lilith === true;
  if (definition.category === 'node') return aspectsTo?.lunarNodes === true;
  return true;
}

export interface DraconicData {
  readonly natal: ChartData;
  /** The draconic chart itself: transformed positions, the natal houses unchanged, and its own aspects, dignities, sect and Arabic parts. */
  readonly draconic: ChartData;
}

/** `provider` must already be initialized. Follows `options.nodeVariant` ('mean' by default) for which Node the draconic zero-point is measured from, same as the natal chart itself. */
export async function computeDraconic(
  moment: BirthMomentInput,
  provider: EphemerisProvider,
  options: ChartCalculationOptions = {},
  orbConfig?: OrbConfig,
): Promise<DraconicData> {
  const natal = await computeChartData(moment, provider, options);

  const nodeDefinition = bodyByKey(options.nodeVariant === 'true' ? 'trueNode' : 'meanNode');
  if (nodeDefinition === undefined) throw new Error('unreachable: the Node is always one of BODIES');
  const natalPositionByBody = new Map(natal.positions.map((position) => [position.body, position]));
  const nodePosition = natalPositionByBody.get(nodeDefinition.id);
  if (nodePosition === undefined) throw new Error('unreachable: the natal chart always carries a Node position');
  const nodeLongitude = nodePosition.longitude;

  const positions: BodyPosition[] = natal.positions.map((position) => draconicPosition(position, nodeLongitude));
  const houses = natal.houses;

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
    throw new Error('unreachable: the natal chart always carries a Sun and Moon position');
  }

  const sect: Sect = sectOf(sunPosition.longitude, houses.ascendant);

  const draconic: ChartData = {
    positions,
    houses,
    aspects,
    dignities,
    sect,
    partOfFortune: partOfFortune(sect, houses.ascendant, sunPosition.longitude, moonPosition.longitude),
    partOfSpirit: partOfSpirit(sect, houses.ascendant, sunPosition.longitude, moonPosition.longitude),
  };

  return { natal, draconic };
}
