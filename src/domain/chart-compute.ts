/**
 * Computes everything a chart's data tables need from a birth moment (#44).
 *
 * Deliberately decoupled from the `Chart` entity in `chart.ts`: that entity
 * holds no computed positions by design (see its own doc comment), and no UI
 * yet exists to create or persist one. This module instead takes a birth
 * moment directly, the same input `PersonForm`/`person-form.ts` already
 * produce, so a future chart-settings UI can supply real `ChartCalculationOptions`
 * later without this module changing shape.
 *
 * Everything here is one pass over the ephemeris: a single Julian day, one
 * batch position call, one house call, then pure arithmetic over the results
 * for aspects, dignities, sect and the two derived points. Nothing is cached
 * or stored — recomputing is cheap, and storing results would only create a
 * second version of the truth the `Chart` doc comment already warns against.
 */
import { findAspects, type Aspect, type AspectSubject } from '../astrology/aspects.js';
import { bodyByKey, BODIES } from '../astrology/bodies.js';
import { essentialDignities, type EssentialDignities } from '../astrology/dignities.js';
import { partOfFortune, partOfSpirit } from '../astrology/arabic-parts.js';
import { sectOf, type Sect } from '../astrology/sect.js';
import { julianDayFor } from '../time/julian.js';
import { resolveMoment } from '../time/resolve.js';
import type {
  BodyId,
  BodyPosition,
  Degrees,
  EphemerisProvider,
  GeoPosition,
  HousePositions,
  HouseSystem,
  Zodiac,
} from '../ephemeris/types.js';
import type { BirthMomentInput } from '../time/types.js';

/** Placidus, the system every other screen in the app defaults to. */
const DEFAULT_HOUSE_SYSTEM: HouseSystem = 'P';

export interface ChartCalculationOptions {
  readonly houseSystem?: HouseSystem;
  readonly zodiac?: Zodiac;
}

export interface ChartData {
  readonly positions: readonly BodyPosition[];
  readonly houses: HousePositions;
  readonly aspects: readonly Aspect[];
  readonly dignities: ReadonlyMap<BodyId, EssentialDignities>;
  readonly sect: Sect;
  readonly partOfFortune: Degrees;
  readonly partOfSpirit: Degrees;
}

/**
 * Computes a chart's positions, houses, aspects, dignities, sect and the two
 * classical derived points from a birth moment.
 *
 * `provider` must already be initialized. Houses, the Ascendant and the
 * derived points (both built on the Ascendant) are computed the same as for
 * any other moment — callers with an `'unknown'`-accuracy birth time are
 * responsible for not showing them, per `Person.timeAccuracy`'s own doc
 * comment: an unknown time makes them meaningless, not merely approximate.
 */
export async function computeChartData(
  moment: BirthMomentInput,
  provider: EphemerisProvider,
  options: ChartCalculationOptions = {},
): Promise<ChartData> {
  const resolved = resolveMoment(moment);
  const jd = await julianDayFor(provider, resolved);
  const place: GeoPosition = { ...moment.coordinates, altitude: 0 };
  const positionOptions = options.zodiac === undefined ? undefined : { zodiac: options.zodiac };

  const [positions, houses] = await Promise.all([
    provider.positions(
      jd,
      BODIES.map((body) => body.id),
      positionOptions,
    ),
    provider.houses(jd, place, options.houseSystem ?? DEFAULT_HOUSE_SYSTEM, options.zodiac),
  ]);

  const positionByBody = new Map(positions.map((position) => [position.body, position]));
  const subjects: AspectSubject[] = BODIES.flatMap((body) => {
    const position = positionByBody.get(body.id);
    return position === undefined ? [] : [{ body: body.id, position, category: body.category }];
  });
  const aspects = findAspects(subjects);

  const dignities = new Map<BodyId, EssentialDignities>(
    positions.map((position) => [position.body, essentialDignities(position.body, position.longitude)]),
  );

  const sun = bodyByKey('sun');
  const moon = bodyByKey('moon');
  if (sun === undefined || moon === undefined) throw new Error('unreachable: sun/moon are always in BODIES');
  const sunPosition = positionByBody.get(sun.id);
  const moonPosition = positionByBody.get(moon.id);
  if (sunPosition === undefined || moonPosition === undefined) {
    throw new Error('unreachable: the ephemeris returned no position for the Sun or Moon');
  }

  const sect = sectOf(sunPosition.longitude, houses.ascendant);

  return {
    positions,
    houses,
    aspects,
    dignities,
    sect,
    partOfFortune: partOfFortune(sect, houses.ascendant, sunPosition.longitude, moonPosition.longitude),
    partOfSpirit: partOfSpirit(sect, houses.ascendant, sunPosition.longitude, moonPosition.longitude),
  };
}
