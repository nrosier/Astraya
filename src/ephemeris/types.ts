/**
 * Types at the ephemeris boundary.
 *
 * Nothing here mentions sweph-wasm. That is the point: `src/astrology/**` works
 * against these types, so the engine stays swappable and the pure astrology code
 * is testable without WebAssembly.
 */

/** Ecliptic longitude in degrees, 0 <= lon < 360, measured from 0° Aries. */
export type Degrees = number;

/** Julian day number in Universal Time. */
export type JulianDayUT = number;

/**
 * Which calendar a written date is in.
 *
 * Deliberately not `Calendar` from `src/time`: that type has an `auto` member,
 * and by the time a date reaches the ephemeris boundary the ambiguity must
 * already be resolved. An engine is the wrong place to be guessing.
 */
export type CalendarSystem = 'gregorian' | 'julian';

/** Swiss Ephemeris body identifier. See `SE` in generated-constants.ts. */
export type BodyId = number;

/** Which zodiac the longitudes are measured in. */
export type Zodiac = { readonly kind: 'tropical' } | { readonly kind: 'sidereal'; readonly ayanamsa: number };

/** Where the observer is, for topocentric positions and house calculation. */
export interface GeoPosition {
  /** Degrees north of the equator; negative for south. */
  readonly latitude: number;
  /** Degrees east of Greenwich; negative for west. */
  readonly longitude: number;
  /** Metres above sea level. Affects topocentric positions only. */
  readonly altitude: number;
}

/** A body's position and motion at an instant. */
export interface BodyPosition {
  readonly body: BodyId;
  /** Ecliptic longitude, in the requested zodiac. */
  readonly longitude: Degrees;
  /** Ecliptic latitude in degrees. */
  readonly latitude: number;
  /** Distance in AU. */
  readonly distance: number;
  /** Change in longitude per day; negative means retrograde. */
  readonly longitudeSpeed: number;
  readonly latitudeSpeed: number;
  readonly distanceSpeed: number;
  /** True when `longitudeSpeed < 0`. Derived here so callers cannot forget. */
  readonly retrograde: boolean;
}

/** House cusps and the angles derived from them. */
export interface HousePositions {
  /**
   * Cusp longitudes, index 1..n. Index 0 is unused so that `cusps[1]` is the
   * first house, matching every astrological text and the C API.
   */
  readonly cusps: readonly Degrees[];
  readonly ascendant: Degrees;
  readonly midheaven: Degrees;
  /** Right ascension of the midheaven. */
  readonly armc: Degrees;
  readonly vertex: Degrees;
  readonly equatorialAscendant: Degrees;
  /** Co-ascendant, Koch variant. */
  readonly coAscendantKoch: Degrees;
  /** Co-ascendant, Munkasey variant. */
  readonly coAscendantMunkasey: Degrees;
  /** Polar ascendant, Munkasey. */
  readonly polarAscendant: Degrees;
  /** The system actually used, which may differ from the one requested. */
  readonly system: HouseSystem;
  /**
   * Set when the requested system was undefined at this latitude and a fallback
   * was used — Placidus and Koch fail beyond roughly +/-66.5 degrees. Never
   * silently ignored: the UI must show this.
   */
  readonly warning?: string;
}

/**
 * House system, identified by the Swiss Ephemeris single-character code.
 * The full set is enumerated in houses.ts; the type is kept open here because
 * the boundary should not need editing when a system is added to the UI.
 */
export type HouseSystem = string;

export interface PositionOptions {
  readonly zodiac?: Zodiac;
  /** Compute topocentric rather than geocentric positions. */
  readonly observer?: GeoPosition;
  /** Return equatorial (RA/declination) instead of ecliptic coordinates. */
  readonly equatorial?: boolean;
  /** True positions rather than apparent (no light-time correction). */
  readonly truePositions?: boolean;
}

/**
 * The engine interface the rest of Astraya talks to.
 *
 * Every method is async because the real implementation lives in a Web Worker.
 * Errors are thrown, never encoded as sentinel values — Swiss Ephemeris signals
 * failure through a `serr` string that is easy to ignore, and ignoring it is how
 * a chart ends up quietly wrong.
 */
export interface EphemerisProvider {
  /** Load the WASM module and ephemeris data. Safe to call more than once. */
  initialize(): Promise<void>;

  /**
   * Julian day (UT) from a calendar date and decimal hour.
   *
   * The date is read in `calendar`, defaulting to Gregorian. Julian is not merely
   * a pre-1582 concern: Russia kept the Julian calendar until 1918 and Greece until
   * 1923, so a date written in 1900 may be either, and the difference is 13 days.
   */
  julianDay(year: number, month: number, day: number, hour: number, calendar?: CalendarSystem): Promise<JulianDayUT>;

  /**
   * Julian day (UT) from UTC, using the library's leap-second aware conversion.
   *
   * Gregorian by design, and only meaningful from 1972 onward: UTC — and therefore
   * leap seconds — did not exist before then, so for earlier dates there is nothing
   * for this path to be more accurate about. Use `julianDay` there.
   */
  julianDayFromUtc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
  ): Promise<JulianDayUT>;

  position(jd: JulianDayUT, body: BodyId, options?: PositionOptions): Promise<BodyPosition>;

  positions(jd: JulianDayUT, bodies: readonly BodyId[], options?: PositionOptions): Promise<readonly BodyPosition[]>;

  houses(jd: JulianDayUT, place: GeoPosition, system: HouseSystem, zodiac?: Zodiac): Promise<HousePositions>;

  /**
   * The library's own display name for a house system, via `swe_house_name`.
   * The authoritative source for UI labels: the canonical code list lives in
   * `src/astrology/houses.ts`, but the text shown to a user comes from here
   * rather than a second, hand-maintained copy that could drift from it.
   */
  houseSystemName(system: HouseSystem): Promise<string>;

  /** Ayanamsa value in degrees for the given instant and sidereal mode. */
  ayanamsa(jd: JulianDayUT, mode: number): Promise<Degrees>;

  /**
   * The library's own display name for a sidereal mode, via
   * `swe_get_ayanamsa_name`. Mirrors `houseSystemName`: the canonical id list
   * lives in `src/astrology/ayanamsas.ts`, but the text shown to a user comes
   * from here so it cannot drift from a second, hand-maintained copy.
   */
  ayanamsaName(mode: number): Promise<string>;

  /**
   * Swiss Ephemeris library version. Shown on the About page, which the AGPL
   * network clause obliges us to provide.
   */
  version(): Promise<string>;

  /** Release the worker and WASM instance. */
  dispose(): Promise<void>;
}

/** Thrown when Swiss Ephemeris reports an error, carrying its own message. */
export class EphemerisError extends Error {
  /**
   * Which call failed and on what input. Explicit field rather than a parameter
   * property: parameter properties are not erasable, and this project compiles
   * under `erasableSyntaxOnly` so that Node can run the TypeScript directly.
   */
  readonly context: EphemerisErrorContext;

  constructor(message: string, context: EphemerisErrorContext) {
    super(message);
    this.name = 'EphemerisError';
    this.context = context;
  }
}

export interface EphemerisErrorContext {
  readonly call: string;
  readonly jd?: number;
  readonly body?: number;
}
