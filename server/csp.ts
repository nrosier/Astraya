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
 * it to a canvas.
 *
 * `connect-src`'s one exception to `'self'` is Nominatim's geocoding host
 * (#290, #291): `BirthPlaceSearch.tsx`'s "Search for a place by name" field
 * turns a typed place name into coordinates via a `fetch()` to
 * `nominatim.openstreetmap.org` by default. Kept as its own `geocodeOrigin`
 * config field so a self-hoster can point it at their own server instead.
 */
const DEFAULT_GEOCODE_ORIGIN = 'https://nominatim.openstreetmap.org';

export const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self' ${DEFAULT_GEOCODE_ORIGIN}`,
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
   * Scheme + host of a self-hosted Nominatim instance, replacing the default
   * public `nominatim.openstreetmap.org` in `connect-src` (#290, #291) — not
   * appended, since a deployer pointing at their own server has usually chosen
   * to make zero calls to the public one.
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
 * `geocodeOrigin` rewrites the Nominatim-host half of `connect-src` (#290,
 * #291), replacing the default public host rather than adding to it.
 */
export function buildCsp(config: CspConfig = {}): BuiltCsp {
  const { issuerOrigin, geocodeOrigin } = config;
  const effectiveGeocodeOrigin = geocodeOrigin ?? DEFAULT_GEOCODE_ORIGIN;
  const directives = CSP_DIRECTIVES.map((directive) => {
    if (issuerOrigin !== undefined && directive === "form-action 'none'") return `form-action ${issuerOrigin}`;
    if (directive.startsWith('connect-src')) {
      return `connect-src 'self' ${effectiveGeocodeOrigin}`;
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
