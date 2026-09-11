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
 */
export const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
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
 */
export function buildCsp(config: CspConfig = {}): BuiltCsp {
  const { issuerOrigin } = config;
  const directives =
    issuerOrigin === undefined
      ? CSP_DIRECTIVES
      : CSP_DIRECTIVES.map((directive) => {
          if (directive === "form-action 'none'") return `form-action ${issuerOrigin}`;
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
