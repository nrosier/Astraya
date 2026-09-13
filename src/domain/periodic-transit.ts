/**
 * Periodic transit forecast (#207): daily, weekly, monthly and yearly tiers
 * of "what's happening in the sky against this natal chart right now",
 * following the same natal/transiting split `computeTransit` already models
 * (`fixedSubjects` for the natal side, `subjectsFrom`/real speed for the
 * transiting side) rather than inventing a new convention.
 *
 * Each tier answers a different question, at a different grain, so each
 * needs different machinery:
 *
 * - **Daily** — the transiting Moon's current sign/house against the natal
 *   chart and its in-orb (not necessarily exact) aspects, since a whole-day
 *   grain is exactly what the Moon (~13°/day) is fast enough to make
 *   meaningful; plus any exact aspect (Moon included) and any fast-planet
 *   station landing within that specific day.
 * - **Weekly/monthly** — exact aspects only (`findExactTransitAspects`,
 *   `astrology/transit-events.ts`), for the Sun and the eight `'planet'`-
 *   category bodies. The Moon is deliberately excluded here: at ~13°/day it
 *   would produce several exact aspects to most of the natal chart every
 *   single week, which is not what "what's exact this week" is asking for —
 *   that's the daily tier's job. Monthly additionally reports the transiting
 *   Sun's natal house/sign for the month, since the Sun's position changes
 *   little enough within a month that a single house/sign is a meaningful
 *   summary the way it isn't for any faster body.
 * - **Yearly** — ties into `computeSolarReturn` directly rather than
 *   reinventing an annual forecast, per this issue's own scope note. This is
 *   also the resolution `report.ts`'s file doc promised for M7 #61's
 *   deferred "current timing from progressions and the year's solar return"
 *   item: superseded, not carried forward — the progressions half of that
 *   note already has its own dedicated screen (`SecondaryProgressionView.tsx`,
 *   M6), and forcing a solar return's cross-chart contacts into `ChartData`'s
 *   shape (which `report.ts` correctly declined to do, since a return has no
 *   `dignities`/`sect` of its own) is exactly what this separate forecast
 *   pipeline exists to avoid needing.
 *
 * No text lives here. Like `computeChartData`/`computeTransit`, this module
 * produces structured events keyed by `BodyId`; turning an event into a
 * sentence is `interpretation/compose.ts`'s job (via the `transit-aspect`
 * `CorpusPlacement` category, #207's schema addition) and is left to the UI
 * layer that has a locale and persona to ask for, the same separation
 * `ReportView.tsx` already keeps from `report.ts`.
 */
import { findCrossAspects, fixedSubjects, subjectsFrom, type Aspect, type OrbConfig } from '../astrology/aspects.js';
import { BODIES, bodyById, bodyByKey, type BodyCategory } from '../astrology/bodies.js';
import { houseOf } from '../astrology/emphasis.js';
import { findStations, type StationEvent } from '../astrology/stations.js';
import { findExactTransitAspects, type TransitAspectEvent } from '../astrology/transit-events.js';
import { computeChartData, type ChartCalculationOptions, type ChartData } from './chart-compute.js';
import { computeSolarReturn, type SolarReturnData, type SolarReturnOptions } from './solar-return.js';
import type { BodyId, BodyPosition, EphemerisProvider, GeoPosition, JulianDayUT } from '../ephemeris/types.js';
import type { BirthMomentInput } from '../time/types.js';

function categoryOf(body: BodyId): BodyCategory {
  const definition = bodyById(body);
  if (definition === undefined) throw new Error(`unreachable: ${String(body)} is always one of BODIES`);
  return definition.category;
}

function requireBodyId(key: string): BodyId {
  const definition = bodyByKey(key);
  if (definition === undefined) throw new Error(`unreachable: "${key}" is always one of BODIES`);
  return definition.id;
}

const MOON_ID = requireBodyId('moon');

/** Mercury, Venus, Mars — the bodies close enough to Earth to station often enough for a daily check to matter. */
const FAST_PLANET_IDS: readonly BodyId[] = ['mercury', 'venus', 'mars'].map(requireBodyId);

/** Sun plus the eight `'planet'`-category bodies — the Moon is excluded; see the file doc for why. */
const WEEKLY_MONTHLY_BODY_IDS: readonly BodyId[] = BODIES.filter(
  (body) => body.key === 'sun' || body.category === 'planet',
).map((body) => body.id);

function natalLongitudes(natal: ChartData): ReadonlyMap<BodyId, number> {
  return new Map(natal.positions.map((position) => [position.body, position.longitude]));
}

function signOf(longitude: number): number {
  return Math.floor((((longitude % 360) + 360) % 360) / 30);
}

export interface DailyTransitForecast {
  readonly jd: JulianDayUT;
  readonly moon: { readonly position: BodyPosition; readonly sign: number; readonly house: number };
  /** In-orb (not necessarily exact) aspects from the transiting Moon to the fixed natal chart. */
  readonly moonAspects: readonly Aspect[];
  /** Any exact aspect (any body, Moon included) landing within this day, in chronological order. */
  readonly exactToday: readonly TransitAspectEvent[];
  /** Any fast-planet (Mercury/Venus/Mars) station landing within this day, in chronological order. */
  readonly stationsToday: readonly StationEvent[];
}

export interface WeeklyTransitForecast {
  readonly fromJd: JulianDayUT;
  readonly toJd: JulianDayUT;
  /** Exact aspects (Sun and the eight planets, natal chart in full) within the window, in chronological order. */
  readonly events: readonly TransitAspectEvent[];
}

export interface MonthlyTransitForecast {
  readonly fromJd: JulianDayUT;
  readonly toJd: JulianDayUT;
  readonly events: readonly TransitAspectEvent[];
  /** The transiting Sun's natal sign/house at `fromJd`, standing for the month as a whole. */
  readonly sun: { readonly sign: number; readonly house: number };
}

export interface YearlyTransitForecast {
  readonly solarReturn: SolarReturnData;
}

export interface PeriodicTransitForecast {
  readonly natal: ChartData;
  readonly daily: DailyTransitForecast;
  readonly weekly: WeeklyTransitForecast;
  readonly monthly: MonthlyTransitForecast;
  readonly yearly: YearlyTransitForecast;
}

export interface PeriodicTransitPeriods {
  /** The day this forecast is anchored to — the caller's "today" (or any other chosen day), as a Julian day. */
  readonly dayJd: JulianDayUT;
  /**
   * Bounds of the calendar month the monthly tier should cover. Left to the
   * caller because only it knows the civil calendar `dayJd` falls in — the
   * same division of responsibility `computeTransit`'s own `targetJd` doc
   * comment describes ("defaulting to now is the caller's job").
   */
  readonly monthFromJd: JulianDayUT;
  readonly monthToJd: JulianDayUT;
  /** Calendar year the yearly tier's solar return should be computed for. */
  readonly year: number;
}

export interface PeriodicTransitOptions extends ChartCalculationOptions {
  readonly solarReturnPlace?: GeoPosition;
}

/**
 * `provider` must already be initialized. Casts one natal chart, then
 * derives all four tiers from it plus the ephemeris — one round trip for the
 * daily Moon position, one sampled search each for the weekly and monthly
 * exact-aspect windows (sharing the same body set and natal longitudes), one
 * station search over the anchor day, and one solar-return computation for
 * the yearly tier.
 */
export async function computePeriodicTransitForecast(
  natalMoment: BirthMomentInput,
  periods: PeriodicTransitPeriods,
  provider: EphemerisProvider,
  options: PeriodicTransitOptions = {},
  orbConfig?: OrbConfig,
): Promise<PeriodicTransitForecast> {
  const { dayJd, monthFromJd, monthToJd, year } = periods;
  const weekFromJd = dayJd;
  const weekToJd = dayJd + 7;
  const zodiacOption = options.zodiac === undefined ? {} : { zodiac: options.zodiac };

  const solarReturnOptions: SolarReturnOptions = {
    ...(options.solarReturnPlace === undefined ? {} : { place: options.solarReturnPlace }),
    ...(options.houseSystem === undefined ? {} : { houseSystem: options.houseSystem }),
    ...zodiacOption,
  };

  // The natal chart is needed (for its longitudes) before any of the transit searches below can
  // run, so it resolves on its own first; everything that follows is independent of everything
  // else and runs together.
  const natal = await computeChartData(natalMoment, provider, options);
  const natalMap = natalLongitudes(natal);

  const [
    moonPositions,
    weeklyResolved,
    monthlyResolved,
    monthSunPositions,
    stationsToday,
    moonExactToday,
    solarReturn,
  ] = await Promise.all([
    provider.positions(dayJd, [MOON_ID]),
    findExactTransitAspects(provider, WEEKLY_MONTHLY_BODY_IDS, natalMap, weekFromJd, weekToJd, zodiacOption),
    findExactTransitAspects(provider, WEEKLY_MONTHLY_BODY_IDS, natalMap, monthFromJd, monthToJd, zodiacOption),
    provider.positions(monthFromJd, [requireBodyId('sun')]),
    findStations(provider, FAST_PLANET_IDS, dayJd, dayJd + 1, zodiacOption),
    // A finer step than the default: over just one day, the Moon's ~13 deg/day motion needs a
    // tighter sample than the half-day step that is safe for every slower body this module
    // otherwise searches with.
    findExactTransitAspects(provider, [MOON_ID], natalMap, dayJd, dayJd + 1, {
      ...zodiacOption,
      sampleStepDays: 0.1,
    }),
    computeSolarReturn(natalMoment, year, provider, solarReturnOptions, orbConfig),
  ]);

  const moonPosition = moonPositions[0];
  if (moonPosition === undefined) throw new Error('unreachable: the ephemeris returned no position for the Moon');
  const moonAspects = findCrossAspects(
    subjectsFrom([moonPosition], categoryOf),
    fixedSubjects(natal.positions, categoryOf),
    orbConfig,
  );

  // Any other body's exact aspect landing today is already inside the weekly window (which
  // starts at dayJd), so it's filtered out of that result rather than searched for again.
  const otherExactToday = weeklyResolved.filter((event) => event.jd < dayJd + 1);
  const exactToday = [...moonExactToday, ...otherExactToday].sort((a, b) => a.jd - b.jd);

  const sunPosition = monthSunPositions[0];
  if (sunPosition === undefined) throw new Error('unreachable: the ephemeris returned no position for the Sun');

  return {
    natal,
    daily: {
      jd: dayJd,
      moon: {
        position: moonPosition,
        sign: signOf(moonPosition.longitude),
        house: houseOfNatal(moonPosition.longitude, natal),
      },
      moonAspects,
      exactToday,
      stationsToday,
    },
    weekly: { fromJd: weekFromJd, toJd: weekToJd, events: weeklyResolved },
    monthly: {
      fromJd: monthFromJd,
      toJd: monthToJd,
      events: monthlyResolved,
      sun: { sign: signOf(sunPosition.longitude), house: houseOfNatal(sunPosition.longitude, natal) },
    },
    yearly: { solarReturn },
  };
}

function houseOfNatal(longitude: number, natal: ChartData): number {
  return houseOf(longitude, natal.houses.cusps);
}
