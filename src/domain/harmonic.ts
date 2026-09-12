/**
 * Computes a harmonic or Vedic Varga chart from one person's natal chart (#170).
 *
 * Like the composite chart (#169), a harmonic chart is a synthetic chart, not a comparison — so
 * this reuses the single-chart engine (`findAspects`, `essentialDignities`, `sectOf`, the two
 * Arabic parts) to compute fresh aspects/dignities/sect/parts from the transformed positions and
 * houses, exactly the way `computeChartDataAtJd` does for a real chart. The transform itself
 * (`harmonicLongitude`, `harmonicPosition`, `harmonicHouses`) lives in `astrology/harmonics.ts`,
 * including the doc comment on which Varga convention is used and why — this module only wires
 * that transform into a full `ChartData`.
 */
import { DEFAULT_ORB_CONFIG, findAspects, subjectsFrom, type Aspect, type OrbConfig } from '../astrology/aspects.js';
import { bodyByKey, bodyById, type BodyCategory } from '../astrology/bodies.js';
import { essentialDignities, type EssentialDignities } from '../astrology/dignities.js';
import { partOfFortune, partOfSpirit } from '../astrology/arabic-parts.js';
import { harmonicHouses, harmonicPosition } from '../astrology/harmonics.js';
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

export interface HarmonicData {
  readonly natal: ChartData;
  /** The harmonic/Varga chart itself: transformed positions, whole-sign houses, and its own aspects, dignities, sect and Arabic parts. */
  readonly harmonic: ChartData;
}

/**
 * `n` is the harmonic number (5, 7, ... or a Varga preset's `n`, e.g. 9 for D9 Navamsha). Must be
 * a positive integer; `n=1` reproduces the natal chart itself (with whole-sign houses in place of
 * whatever house system the natal chart used). `provider` must already be initialized.
 */
export async function computeHarmonic(
  moment: BirthMomentInput,
  n: number,
  provider: EphemerisProvider,
  options: ChartCalculationOptions = {},
  orbConfig?: OrbConfig,
): Promise<HarmonicData> {
  if (!Number.isInteger(n) || n < 1) throw new Error(`harmonic number must be a positive integer, got ${String(n)}`);

  const natal = await computeChartData(moment, provider, options);

  const positions: BodyPosition[] = natal.positions.map((position) => harmonicPosition(position, n));
  const houses = harmonicHouses(natal.houses, n);

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

  const harmonic: ChartData = {
    positions,
    houses,
    aspects,
    dignities,
    sect,
    partOfFortune: partOfFortune(sect, houses.ascendant, sunPosition.longitude, moonPosition.longitude),
    partOfSpirit: partOfSpirit(sect, houses.ascendant, sunPosition.longitude, moonPosition.longitude),
  };

  return { natal, harmonic };
}
