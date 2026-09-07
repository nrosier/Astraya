/**
 * The Swiss Ephemeris boundary: the only module in Astraya that touches
 * `sweph-wasm`.
 *
 * This is deliberately a plain module rather than worker-only code, so the same
 * implementation runs on the main thread, inside a Web Worker, and directly in
 * Node under Vitest. The golden-chart gate therefore tests exactly what ships.
 *
 * Two properties of the underlying library shaped this file and are easy to get
 * wrong, so they are asserted rather than assumed:
 *
 * 1. `swe_houses_ex2` returns 13 cusps with **index 0 unused** — houses are
 *    1..12, matching the C API and every astrological text. The package's own
 *    type declarations claim `cusp[0]` is the first house; that is wrong, and
 *    believing it rotates every chart by one house. Verified empirically:
 *    `cusps[1] === ascmc[0]` (Ascendant) and `cusps[10] === ascmc[1]` (MC).
 *
 * 2. Sidereal mode and the topocentric observer are *global mutable state* on
 *    the WASM instance, not per-call arguments. Every call that depends on them
 *    sets them first. Relying on a previous call's setting is how a sidereal
 *    request silently returns tropical longitudes.
 */
import { EPHEMERIS_DATA_FILES, EPHEMERIS_YEAR_RANGE, EPHE_BASE_URL } from './assets.js';
import { SE } from './generated-constants.js';
import {
  EphemerisError,
  type BodyId,
  type BodyPosition,
  type Degrees,
  type EphemerisProvider,
  type GeoPosition,
  type HousePositions,
  type HouseSystem,
  type JulianDayUT,
  type PositionOptions,
  type Zodiac,
} from './types.js';

/** Index of each value in the `ascmc` array returned by the houses functions. */
const ASCMC = {
  ascendant: 0,
  midheaven: 1,
  armc: 2,
  vertex: 3,
  equatorialAscendant: 4,
  coAscendantKoch: 5,
  coAscendantMunkasey: 6,
  polarAscendant: 7,
} as const;

/** Gregorian calendar, as opposed to Julian. */
const GREGORIAN = SE.SE_GREG_CAL;

/**
 * Base flags for every position request.
 *
 * `SEFLG_SWIEPH` selects the compressed Swiss Ephemeris data files rather than
 * the built-in Moshier analytic theory, which is orders of magnitude less
 * accurate. `SEFLG_SPEED` is always on: speed is what tells us a planet is
 * retrograde, and it is needed for progressions.
 */
const BASE_FLAGS = SE.SEFLG_SWIEPH | SE.SEFLG_SPEED;

export interface EngineConfig {
  /**
   * Base URL the `.se1` files are served from. Same-origin `/ephe/` in the
   * browser; a `file://` URL in Node tests.
   */
  readonly epheBaseUrl?: string;
  /** Optional override for the WASM binary location. */
  readonly wasmUrl?: string;
}

/** Minimal shape of the sweph-wasm instance, kept local to this module. */
interface SweInstance {
  wasm: { FS: { analyzePath(path: string, dontResolveLastLink?: boolean): { exists: boolean } } };
  swe_set_ephe_path(url?: string, files?: readonly string[]): Promise<unknown>;
  swe_set_sid_mode(mode: number, t0: number, ayanT0: number): void;
  swe_set_topo(longitude: number, latitude: number, altitude: number): void;
  swe_julday(year: number, month: number, day: number, hour: number, gregflag: number): number;
  swe_utc_to_jd(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
    gregflag: number,
  ): readonly number[];
  swe_calc_ut(jd: number, body: number, flags: number): readonly number[];
  swe_houses_ex2(
    jd: number,
    flags: number,
    latitude: number,
    longitude: number,
    hsys: string,
  ): { cusps: readonly (number | null)[]; ascmc: readonly number[] };
  swe_get_ayanamsa_ex_ut(jd: number, flags: number): number;
  swe_version(): string;
  swe_close(): void;
}

/** Normalise to the half-open interval [0, 360). */
function norm360(degrees: number): Degrees {
  const value = degrees % 360;
  return value < 0 ? value + 360 : value;
}

export class SwissEphemerisEngine implements EphemerisProvider {
  #swe: SweInstance | undefined;
  #initializing: Promise<void> | undefined;
  /** Tracks the sidereal mode currently set on the WASM instance. */
  #sidModeSet: number | undefined;
  readonly #config: EngineConfig;

  constructor(config: EngineConfig = {}) {
    this.#config = config;
  }

  async initialize(): Promise<void> {
    this.#initializing ??= this.#doInitialize();
    return this.#initializing;
  }

  async #doInitialize(): Promise<void> {
    const { default: SwissEPH } = await import('sweph-wasm');
    const swe = await (SwissEPH as unknown as { init(wasmPath?: string): Promise<SweInstance> }).init(
      this.#config.wasmUrl,
    );

    const baseUrl = this.#config.epheBaseUrl ?? EPHE_BASE_URL;
    const files = EPHEMERIS_DATA_FILES.map((asset) => asset.file);
    await swe.swe_set_ephe_path(baseUrl, files);

    // `swe_set_ephe_path` swallows per-file failures and only throws when EVERY
    // file fails to load. A partial load would silently fall back to the Moshier
    // theory for the missing bodies — wrong by arcminutes, with no error. So
    // verify each expected file actually landed in the WASM filesystem.
    const missing = files.filter((file) => !swe.wasm.FS.analyzePath(`/ephe/${file}`).exists);
    if (missing.length > 0) {
      throw new EphemerisError(
        `Ephemeris data files failed to load: ${missing.join(', ')}. ` +
          `Expected them under ${baseUrl}. Refusing to compute with reduced accuracy.`,
        { call: 'swe_set_ephe_path' },
      );
    }

    this.#swe = swe;
  }

  #instance(): SweInstance {
    if (!this.#swe) {
      throw new EphemerisError('Engine used before initialize() completed', { call: 'initialize' });
    }
    return this.#swe;
  }

  /**
   * Applies a zodiac choice, returning the flags to OR into the request.
   *
   * Sidereal mode is global state on the WASM instance, so it is set on every
   * sidereal call rather than once at startup.
   */
  #applyZodiac(zodiac: Zodiac | undefined): number {
    if (!zodiac || zodiac.kind === 'tropical') return 0;
    const swe = this.#instance();
    if (this.#sidModeSet !== zodiac.ayanamsa) {
      swe.swe_set_sid_mode(zodiac.ayanamsa, 0, 0);
      this.#sidModeSet = zodiac.ayanamsa;
    }
    return SE.SEFLG_SIDEREAL;
  }

  #flagsFor(options: PositionOptions | undefined): number {
    let flags = BASE_FLAGS | this.#applyZodiac(options?.zodiac);
    if (options?.equatorial) flags |= SE.SEFLG_EQUATORIAL;
    if (options?.truePositions) flags |= SE.SEFLG_TRUEPOS;
    if (options?.observer) {
      const swe = this.#instance();
      swe.swe_set_topo(options.observer.longitude, options.observer.latitude, options.observer.altitude);
      flags |= SE.SEFLG_TOPOCTR;
    }
    return flags;
  }

  async julianDay(year: number, month: number, day: number, hour: number): Promise<JulianDayUT> {
    return this.#instance().swe_julday(year, month, day, hour, GREGORIAN);
  }

  async julianDayFromUtc(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
  ): Promise<JulianDayUT> {
    // Returns [jd_et, jd_ut]; we want UT. This path is leap-second aware, which
    // swe_julday is not, so it is preferred wherever a real UTC timestamp exists.
    const [, jdUt] = this.#instance().swe_utc_to_jd(year, month, day, hour, minute, second, GREGORIAN);
    if (jdUt === undefined) {
      throw new EphemerisError('swe_utc_to_jd returned no UT value', { call: 'swe_utc_to_jd' });
    }
    return jdUt;
  }

  async position(jd: JulianDayUT, body: BodyId, options?: PositionOptions): Promise<BodyPosition> {
    this.#assertInRange(jd, body);
    const flags = this.#flagsFor(options);
    let raw: readonly number[];
    try {
      raw = this.#instance().swe_calc_ut(jd, body, flags);
    } catch (cause) {
      throw new EphemerisError(cause instanceof Error ? cause.message : String(cause), {
        call: 'swe_calc_ut',
        jd,
        body,
      });
    }
    const [longitude, latitude, distance, longitudeSpeed, latitudeSpeed, distanceSpeed] = raw as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    return {
      body,
      longitude: norm360(longitude),
      latitude,
      distance,
      longitudeSpeed,
      latitudeSpeed,
      distanceSpeed,
      retrograde: longitudeSpeed < 0,
    };
  }

  async positions(
    jd: JulianDayUT,
    bodies: readonly BodyId[],
    options?: PositionOptions,
  ): Promise<readonly BodyPosition[]> {
    // Sequential on purpose: the WASM instance is single-threaded and the
    // topocentric/sidereal setters are global, so concurrent calls would race.
    const out: BodyPosition[] = [];
    for (const body of bodies) out.push(await this.position(jd, body, options));
    return out;
  }

  async houses(jd: JulianDayUT, place: GeoPosition, system: HouseSystem, zodiac?: Zodiac): Promise<HousePositions> {
    const flags = this.#applyZodiac(zodiac);
    let result: { cusps: readonly (number | null)[]; ascmc: readonly number[] };
    try {
      result = this.#instance().swe_houses_ex2(jd, flags, place.latitude, place.longitude, system);
    } catch (cause) {
      // Placidus and Koch are undefined beyond roughly +/-66.5 degrees, and this
      // is how the library reports it. Surfacing it is mandatory: the fallback
      // cusps the C library would otherwise hand back are not the requested
      // system, and rendering them unlabelled is a silently wrong chart.
      throw new EphemerisError(
        `${cause instanceof Error ? cause.message : String(cause)} ` +
          `(house system '${system}' at latitude ${place.latitude})`,
        { call: 'swe_houses_ex2', jd },
      );
    }

    // Index 0 is unused; houses are 1..12. See the note at the top of this file.
    const cusps: Degrees[] = [Number.NaN];
    for (let house = 1; house < result.cusps.length; house += 1) {
      const value = result.cusps[house];
      if (typeof value !== 'number') {
        throw new EphemerisError(`Cusp ${house} missing from swe_houses_ex2 result`, {
          call: 'swe_houses_ex2',
          jd,
        });
      }
      cusps.push(norm360(value));
    }

    const at = (index: number): Degrees => {
      const value = result.ascmc[index];
      if (value === undefined) {
        throw new EphemerisError(`ascmc[${index}] missing from swe_houses_ex2 result`, {
          call: 'swe_houses_ex2',
          jd,
        });
      }
      return norm360(value);
    };

    return {
      cusps,
      ascendant: at(ASCMC.ascendant),
      midheaven: at(ASCMC.midheaven),
      armc: at(ASCMC.armc),
      vertex: at(ASCMC.vertex),
      equatorialAscendant: at(ASCMC.equatorialAscendant),
      coAscendantKoch: at(ASCMC.coAscendantKoch),
      coAscendantMunkasey: at(ASCMC.coAscendantMunkasey),
      polarAscendant: at(ASCMC.polarAscendant),
      system,
    };
  }

  async ayanamsa(jd: JulianDayUT, mode: number): Promise<Degrees> {
    const swe = this.#instance();
    if (this.#sidModeSet !== mode) {
      swe.swe_set_sid_mode(mode, 0, 0);
      this.#sidModeSet = mode;
    }
    return swe.swe_get_ayanamsa_ex_ut(jd, SE.SEFLG_SWIEPH);
  }

  /** Underlying Swiss Ephemeris version string, for the About page. */
  async version(): Promise<string> {
    return this.#instance().swe_version();
  }

  async dispose(): Promise<void> {
    this.#swe?.swe_close();
    this.#swe = undefined;
    this.#initializing = undefined;
    this.#sidModeSet = undefined;
  }

  /**
   * The shipped `_18` data files cover 1800-2399 CE. Outside that window the
   * library falls back to lower-precision theory without complaint, so refuse
   * instead of returning numbers we cannot stand behind.
   */
  #assertInRange(jd: JulianDayUT, body: BodyId): void {
    const { first, last } = EPHEMERIS_YEAR_RANGE;
    // Julian day at 1800-01-01 and 2400-01-01, computed once rather than guessed.
    const swe = this.#instance();
    const lower = swe.swe_julday(first, 1, 1, 0, GREGORIAN);
    const upper = swe.swe_julday(last + 1, 1, 1, 0, GREGORIAN);
    if (jd < lower || jd >= upper) {
      throw new EphemerisError(
        `Julian day ${jd} is outside the shipped ephemeris range ${first}-${last} CE. ` +
          `Astraya refuses to compute with the reduced-accuracy fallback theory.`,
        { call: 'swe_calc_ut', jd, body },
      );
    }
  }
}
