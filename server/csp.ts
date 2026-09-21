/**
 * The Content Security Policy, defined once.
 *
 * It is served two ways: as a real header by this server, and as a `<meta>` tag in
 * `index.html` so the policy still applies when the built app is hosted as static
 * files. Those two must not drift, so `test/csp.test.ts` asserts the meta tag
 * matches this value — the earlier plan's mistake was to write the policy twice
 * and tighten it later.
 *
 * `connect-src 'self'` is the load-bearing directive. Astraya's interpretation
 * corpus is drafted by an LLM at build time and committed as data; the shipped app
 * must never reach a model provider. This makes that structural rather than a
 * promise. The browser never fetches the OIDC issuer directly either — discovery
 * is resolved server-side (`server/auth/oidc.ts`) and handed to the client, partly
 * because that keeps this guarantee intact and partly because the issuer's
 * discovery endpoint cannot be relied on to send CORS headers a browser fetch would
 * need. `connect-src` therefore stays `'self'` even with OIDC configured.
 *
 * `'wasm-unsafe-eval'` is required to compile the Swiss Ephemeris WebAssembly
 * module. It permits WASM compilation only, not `eval` of JavaScript.
 *
 * `img-src`'s `blob:` is for PNG chart export: `chart-raster.ts` rasterizes a
 * chart's SVG by loading it into an `<img>` from a `blob:` URL before drawing
 * it to a canvas. `https://tile.openstreetmap.org` is the default OpenStreetMap
 * tile host the birth-place map (#159) requests raster tiles from as plain
 * `<img>`s, which needs no `connect-src` grant on its own.
 *
 * `connect-src` carries that same single tile host as one exception to
 * `'self'` (#267): OpenStreetMap's anti-abuse system can return `200 OK` with a
 * small, valid "blocked" placeholder tile instead of an error, which Leaflet's
 * own `tileload` event cannot tell apart from a real tile. `BirthPlaceMap.tsx`
 * detects that case with a `fetch()` probe reading the response's `x-blocked`
 * header directly — something an `<img>` load can never expose. The grant is
 * exactly the origin already trusted for `img-src`, never broadened beyond it,
 * so `test/no-runtime-llm-access.test.ts`'s guarantee holds: this is the tile
 * host the map already loads images from, not a new external destination.
 *
 * The second `connect-src` exception is Nominatim's reverse-geocoding host
 * (#291): `BirthPlaceMap.tsx`'s "Fill in place name" button turns coordinates
 * into a town/city label via a `fetch()` to `nominatim.openstreetmap.org`, the
 * same zero-config OSM default the tile host mirrors. It is additive rather
 * than a replacement for the tile grant — the two are unrelated destinations —
 * and kept as its own `geocodeOrigin` config field rather than reusing
 * `tileOrigin`, so a self-hoster can point either one independently (or not at
 * all) without the other silently following it.
 */
const DEFAULT_TILE_ORIGIN = 'https://tile.openstreetmap.org';
const DEFAULT_GEOCODE_ORIGIN = 'https://nominatim.openstreetmap.org';

export const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${DEFAULT_TILE_ORIGIN}`,
  "font-src 'self'",
  `connect-src 'self' ${DEFAULT_TILE_ORIGIN} ${DEFAULT_GEOCODE_ORIGIN}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
];

/**
 * Directives a `<meta>` tag cannot express, so they are header-only. Astraya has
 * no reason to be framed, and clickjacking a chart app is not interesting, but
 * `frame-ancestors` costs nothing and closes the question.
 */
export const CSP_HEADER_ONLY_DIRECTIVES: readonly string[] = ["frame-ancestors 'none'"];

export interface CspConfig {
  /** Scheme + host of the Authentik issuer, no path — the exact grant #136 calls for. */
  readonly issuerOrigin?: string;
  /**
   * Scheme + host of a self-hosted tile server, replacing the default public OSM
   * host in `img-src` (#159) — not appended, since a deployer pointing at their
   * own tiles has usually chosen to make zero calls to the public OSM host.
   */
  readonly tileOrigin?: string;
  /**
   * Scheme + host of a self-hosted Nominatim instance, replacing the default
   * public `nominatim.openstreetmap.org` in `connect-src` (#291) — not
   * appended, for the same reason as `tileOrigin` above.
   */
  readonly geocodeOrigin?: string;
}

export interface BuiltCsp {
  readonly directives: readonly string[];
  readonly header: string;
  readonly meta: string;
}

/**
 * Builds the policy, optionally scoped to an OIDC issuer. Called with no config
 * (or `issuerOrigin` unset) this is byte-identical to the static policy above —
 * #136 requires the default, no-OIDC deployment to see zero change.
 *
 * Only `form-action` ever gains the issuer origin: the redirect flow top-level-
 * navigates a real `<form>` to the issuer's authorization endpoint. It never
 * fetches from the issuer or loads/executes code from it — the discovery document
 * is fetched server-side (`server/auth/oidc.ts`) — so `connect-src`/`script-src`
 * stay untouched. `form-action 'none'` becomes just the issuer origin rather than
 * appending to `'none'`, since `'none'` alongside another source is a contradiction,
 * not a grant — and nothing else in this app ever submits a form.
 *
 * `tileOrigin` similarly only ever rewrites `img-src` and the tile-host half
 * of `connect-src`, replacing the default public OSM host rather than adding
 * to it (#159, #267) — a self-hosted or MapTiler tile server gets exactly the
 * same pair of grants the default OSM host has, never both at once.
 *
 * `geocodeOrigin` independently rewrites just the Nominatim-host half of
 * `connect-src` (#291), the same way — the two origins are unrelated
 * destinations, so overriding one never touches the other.
 */
export function buildCsp(config: CspConfig = {}): BuiltCsp {
  const { issuerOrigin, tileOrigin, geocodeOrigin } = config;
  const effectiveTileOrigin = tileOrigin ?? DEFAULT_TILE_ORIGIN;
  const effectiveGeocodeOrigin = geocodeOrigin ?? DEFAULT_GEOCODE_ORIGIN;
  const directives = CSP_DIRECTIVES.map((directive) => {
    if (issuerOrigin !== undefined && directive === "form-action 'none'") return `form-action ${issuerOrigin}`;
    if (directive.startsWith('img-src')) return `img-src 'self' data: blob: ${effectiveTileOrigin}`;
    if (directive.startsWith('connect-src')) {
      return `connect-src 'self' ${effectiveTileOrigin} ${effectiveGeocodeOrigin}`;
    }
    return directive;
  });
  return {
    directives,
    header: [...directives, ...CSP_HEADER_ONLY_DIRECTIVES].join('; '),
    meta: directives.join('; '),
  };
}

/** Policy for the `Content-Security-Policy` response header. */
export const CSP_HEADER: string = buildCsp().header;

/** Policy for the `<meta http-equiv>` tag in index.html. */
export const CSP_META: string = buildCsp().meta;

/**
 * Removes the `<meta http-equiv="Content-Security-Policy">` tag from a served
 * `index.html`. Needed only once an issuer is configured, since then the header
 * (which the static meta tag can't express an issuer-scoped `connect-src`/
 * `form-action` into) is the only correct copy of the policy — serving both would
 * leave the *stricter* meta tag blocking the very redirect the header permits, per
 * the CSP spec's "most restrictive policy wins" rule for multiple policies.
 *
 * The same function backs both `server/index.ts`'s stripping and
 * `test/csp.test.ts`'s round-trip assertion, so the two can never drift apart.
 */
export function stripCspMeta(html: string): string {
  return html.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>\n?/, '');
}
