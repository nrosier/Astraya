/**
 * The exact set of Swiss Ephemeris assets Astraea ships, pinned by digest.
 *
 * `sweph-wasm` is a 110 MB package containing 150 `.se1` files. We ship four
 * assets (~2.5 MB) and deliberately exclude the rest. Pinning size and SHA-256
 * means an upstream repack cannot silently change the numbers this app reports:
 * `npm run ephe:sync` fails loudly instead.
 */
export interface EphemerisAsset {
  /** Filename as served from `/ephe/` and as named inside the WASM filesystem. */
  readonly file: string;
  /** Path within the `sweph-wasm` package. */
  readonly from: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly description: string;
}

/** Ephemeris data files loaded into the WASM filesystem at runtime. */
export const EPHEMERIS_DATA_FILES: readonly EphemerisAsset[] = [
  {
    file: 'sepl_18.se1',
    from: 'dist/ephe/sepl_18.se1',
    bytes: 484_055,
    sha256: '0b7e416e3c1be9e6a0dd1d711dae7f7685793a0e7df13f76363a493dc27b6ea1',
    description: 'Planets, 1800-2399 CE',
  },
  {
    file: 'semo_18.se1',
    from: 'dist/ephe/semo_18.se1',
    bytes: 1_304_771,
    sha256: 'ecfa54dbf5bc0b5a9bc3e04ed28629a821e98625eacae38f4070593bba0e2980',
    description: 'Moon, 1800-2399 CE',
  },
  {
    file: 'seas_18.se1',
    from: 'dist/ephe/seas_18.se1',
    bytes: 223_002,
    sha256: '5fd9c2aa1654e37c09a6aeb558076e795409b7dc4bd948ebc0faa7d4a7686b5b',
    description: 'Main asteroids incl. Chiron, 1800-2399 CE',
  },
] as const;

/** The Emscripten build of the Swiss Ephemeris C library. */
export const WASM_BINARY: EphemerisAsset = {
  file: 'swisseph.wasm',
  from: 'dist/wasm/swisseph.wasm',
  bytes: 584_227,
  sha256: 'b8edc953c490d073f542fce22a9d50df85169fbb2e5e6573ec064df9d0bf622d',
  description: 'Swiss Ephemeris compiled to WebAssembly',
};

export const ALL_ASSETS: readonly EphemerisAsset[] = [...EPHEMERIS_DATA_FILES, WASM_BINARY];

/** Public URL prefix the assets are served from. Must stay same-origin for CSP. */
export const EPHE_BASE_URL = '/ephe/';

/** Directory the data files are mounted at inside the WASM filesystem. */
export const EPHE_MOUNT = '/ephe';

/**
 * Date range covered by the shipped `_18` data files, as Gregorian years.
 * Requests outside this window must fail with a clear message rather than
 * returning whatever the fallback Moshier theory produces.
 */
export const EPHEMERIS_YEAR_RANGE = { first: 1800, last: 2399 } as const;
