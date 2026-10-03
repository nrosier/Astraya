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
import {
  DEFAULT_ORB_CONFIG,
  findAspects,
  matchAspect,
  type Aspect,
  type AspectMatch,
  type AspectSubject,
  type OrbConfig,
} from '../astrology/aspects.js';
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
  JulianDayUT,
  Zodiac,
} from '../ephemeris/types.js';
import type { BirthMomentInput } from '../time/types.js';

/** Placidus, the system every other screen in the app defaults to. */
const DEFAULT_HOUSE_SYSTEM: HouseSystem = 'P';

/**
 * The seven traditionally significant "royal"/prominent fixed stars (#398) — a deliberately
 * short, well-known list rather than every star `sefstars.txt` (#33) carries, matching how most
 * mainstream natal-report software surfaces fixed stars at all. Exact spellings confirmed against
 * `public/ephe/sefstars.txt` itself.
 */
export const NATAL_FIXED_STARS: readonly string[] = [
  'Regulus',
  'Spica',
  'Algol',
  'Aldebaran',
  'Antares',
  'Fomalhaut',
  'Sirius',
];

export interface ChartCalculationOptions {
  readonly houseSystem?: HouseSystem;
  readonly zodiac?: Zodiac;
  readonly orbConfig?: OrbConfig;
  /** Which Lilith model `data.positions` carries; the other two are dropped. Default 'mean'. */
  readonly lilithVariant?: 'mean' | 'true' | 'interpolated';
  /** Which lunar-node model `data.positions` carries; the other is dropped. Default 'mean'. */
  readonly nodeVariant?: 'mean' | 'true';
  /**
   * Whether these point families participate in aspect-finding at all. All
   * default to false — Chiron, Lilith and the Nodes are still computed and
   * appear in `data.positions`, just excluded from the pairs `findAspects`
   * checks, matching most astrology tools' own "aspects to" defaults.
   */
  readonly aspectsTo?: {
    readonly chiron?: boolean;
    readonly lilith?: boolean;
    readonly lunarNodes?: boolean;
  };
}

/** Which chart angle an `AngleAspect` is to. */
export type AspectAngle = 'asc' | 'mc';

/**
 * An aspect between a chart angle (the Ascendant or Midheaven) and a body (#413). Separate from
 * `Aspect` because an angle has no `BodyId`; `body` is the body side, `angle` the angle side.
 */
export interface AngleAspect extends AspectMatch {
  readonly angle: AspectAngle;
  readonly body: BodyId;
}

/**
 * How fast the Ascendant and Midheaven sweep the ecliptic, in degrees per day — one turn of the
 * sky per sidereal day. Only used to decide applying/separating for an angle aspect, where the
 * angle's own motion dwarfs any body's, so its exact instantaneous rate doesn't matter.
 */
const ANGLE_SPEED_DEG_PER_DAY = 360.9856;

export interface ChartData {
  readonly positions: readonly BodyPosition[];
  readonly houses: HousePositions;
  readonly aspects: readonly Aspect[];
  /**
   * Aspects from the Ascendant and Midheaven to each body that takes part in `aspects` (#413).
   * Undefined for a composite/harmonic chart (those have no real angles to aspect) and empty when
   * the houses have no solution.
   */
  readonly angleAspects?: readonly AngleAspect[];
  readonly dignities: ReadonlyMap<BodyId, EssentialDignities>;
  readonly sect: Sect;
  readonly partOfFortune: Degrees;
  readonly partOfSpirit: Degrees;
  /**
   * Declination (equatorial, not ecliptic) per body — `declinations.ts`'s parallels/
   * contraparallels/out-of-bounds all key off this. Undefined for a composite/harmonic chart
   * (`composite.ts`/`harmonic.ts`): those positions are synthetic midpoints/multiples with no
   * single real moment or place, so "declination of this point" isn't a coherent question —
   * callers must treat a missing `declinations` as "not applicable here", not as a bug.
   */
  readonly declinations?: ReadonlyMap<BodyId, Degrees>;
  /** True obliquity of the ecliptic at this moment — the out-of-bounds threshold (`declinations.ts`'s own doc comment). Same composite/harmonic caveat as `declinations`. */
  readonly obliquity?: Degrees;
  /**
   * Ecliptic longitude per `NATAL_FIXED_STARS` name, for `fixed-stars.ts`'s `fixedStarConjunctions`
   * (#398). Undefined for a composite/harmonic chart — same reasoning as `declinations`: fixed
   * stars conjunct a real body's own longitude, which a synthetic midpoint/multiple position
   * doesn't coherently have one real moment to look them up for.
   */
  readonly fixedStars?: ReadonlyMap<string, Degrees>;
}

/**
 * Whether `houses` is actually usable, distinct from `Person.timeAccuracy !== 'unknown'` (#378):
 * a *known* birth time at a latitude where the chosen house system has no solution (e.g. inside a
 * polar circle with Placidus) still produces a `HousePositions` — one whose cusps/angles are
 * `NaN`, per `engine.ts`'s own handling of that case — rather than throwing or returning
 * `undefined`. `cusps[0]` is excluded from the check: it is always unused/`NaN` by design (see
 * `HousePositions.cusps`'s own doc comment), not a signal of this failure.
 *
 * Every caller that renders anything built on houses (a position's house via `houseOf`, the
 * Ascendant-based report sections, the wheel) needs this check *in addition to* `timeAccuracy`,
 * not instead of it — `timeAccuracy === 'unknown'` is caught before a chart is even computed, so
 * `houses` is never consulted at all in that case; this check is for the chart that *was*
 * computed, from a real time, but came back without a geometrically valid house division.
 */
export function housesAreDefined(houses: HousePositions): boolean {
  return (
    Number.isFinite(houses.ascendant) &&
    Number.isFinite(houses.midheaven) &&
    houses.cusps.slice(1).every((cusp) => Number.isFinite(cusp))
  );
}

/** Aspects from the Ascendant and Midheaven to every subject, treating each angle as a non-luminary point. */
function findAngleAspects(
  houses: HousePositions,
  subjects: readonly AspectSubject[],
  orbConfig: OrbConfig,
): readonly AngleAspect[] {
  const angles: readonly (readonly [AspectAngle, Degrees])[] = [
    ['asc', houses.ascendant],
    ['mc', houses.midheaven],
  ];
  const result: AngleAspect[] = [];
  for (const [angle, longitude] of angles) {
    const anglePosition: BodyPosition = {
      body: -1,
      longitude,
      latitude: 0,
      distance: 1,
      longitudeSpeed: ANGLE_SPEED_DEG_PER_DAY,
      latitudeSpeed: 0,
      distanceSpeed: 0,
      retrograde: false,
    };
    for (const subject of subjects) {
      const match = matchAspect(anglePosition, 'planet', subject.position, subject.category, orbConfig);
      if (match) result.push({ ...match, angle, body: subject.body });
    }
  }
  return result;
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
  return computeChartDataAtJd(jd, place, provider, options);
}

/**
 * The same computation as `computeChartData`, for a caller that already has a Julian day and
 * place rather than a `BirthMomentInput` to resolve — a transit or "current sky" moment, say,
 * which has no civil birth record of its own. `computeChartData` is the resolve-then-call
 * wrapper of this for the common case; both produce the same `ChartData` shape so any table,
 * wheel or sheet built for one works unchanged for the other.
 */
export async function computeChartDataAtJd(
  jd: JulianDayUT,
  place: GeoPosition,
  provider: EphemerisProvider,
  options: ChartCalculationOptions = {},
): Promise<ChartData> {
  const positionOptions = options.zodiac === undefined ? undefined : { zodiac: options.zodiac };

  // BODIES always carries every Lilith and Node model at once; collapse each
  // down to the one the caller asked for (default 'mean' for both) rather
  // than showing all three Liliths and both Nodes simultaneously.
  const lilithKey =
    options.lilithVariant === 'true'
      ? 'osculatingLilith'
      : options.lilithVariant === 'interpolated'
        ? 'interpolatedLilith'
        : 'meanLilith';
  const nodeKey = options.nodeVariant === 'true' ? 'trueNode' : 'meanNode';
  const bodies = BODIES.filter((body) => {
    if (body.category === 'lilith') return body.key === lilithKey;
    if (body.category === 'node') return body.key === nodeKey;
    return true;
  });

  const [positions, houses, equatorialPositions, obliquity, fixedStarPositions] = await Promise.all([
    provider.positions(
      jd,
      bodies.map((body) => body.id),
      positionOptions,
    ),
    provider.houses(jd, place, options.houseSystem ?? DEFAULT_HOUSE_SYSTEM, options.zodiac),
    // Equatorial reinterprets `.longitude`/`.latitude` as right ascension/declination
    // (`PositionOptions.equatorial`'s own doc comment) — only declination is used here.
    provider.positions(
      jd,
      bodies.map((body) => body.id),
      { ...positionOptions, equatorial: true },
    ),
    provider.obliquity(jd),
    // `fixedStar` has no batch form (one call per name), unlike `positions` — Promise.all over
    // NATAL_FIXED_STARS is the whole batching this gets. Keyed by the *requested* name, not the
    // engine's own returned `.name` (which can carry extra qualifying text — confirmed by
    // test/ephemeris-fixed-stars.test.ts's own `.toContain('regulus')`, not an exact match), so
    // every caller gets the stable key it asked for.
    Promise.all(NATAL_FIXED_STARS.map((name) => provider.fixedStar(jd, name, positionOptions))),
  ]);
  const declinations = new Map<BodyId, Degrees>(
    equatorialPositions.map((position) => [position.body, position.latitude]),
  );
  const fixedStars = new Map<string, Degrees>(
    fixedStarPositions.map((star, index) => [NATAL_FIXED_STARS[index] ?? star.name, star.longitude]),
  );

  const positionByBody = new Map(positions.map((position) => [position.body, position]));
  const aspectsTo = options.aspectsTo ?? {};
  const subjects: AspectSubject[] = bodies.flatMap((body) => {
    const position = positionByBody.get(body.id);
    if (position === undefined) return [];
    if (body.category === 'centaur' && aspectsTo.chiron !== true) return [];
    if (body.category === 'lilith' && aspectsTo.lilith !== true) return [];
    if (body.category === 'node' && aspectsTo.lunarNodes !== true) return [];
    return [{ body: body.id, position, category: body.category }];
  });
  const orbConfig = options.orbConfig ?? DEFAULT_ORB_CONFIG;
  const aspects = findAspects(subjects, orbConfig);
  const angleAspects = housesAreDefined(houses) ? findAngleAspects(houses, subjects, orbConfig) : [];

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
    angleAspects,
    dignities,
    sect,
    partOfFortune: partOfFortune(sect, houses.ascendant, sunPosition.longitude, moonPosition.longitude),
    partOfSpirit: partOfSpirit(sect, houses.ascendant, sunPosition.longitude, moonPosition.longitude),
    declinations,
    obliquity,
    fixedStars,
  };
}
