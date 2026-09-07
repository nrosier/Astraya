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
 * promise. When Authentik OIDC lands in M8, its issuer origin is added here and
 * nowhere else.
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

/** Policy for the `Content-Security-Policy` response header. */
export const CSP_HEADER: string = [...CSP_DIRECTIVES, ...CSP_HEADER_ONLY_DIRECTIVES].join('; ');

/** Policy for the `<meta http-equiv>` tag in index.html. */
export const CSP_META: string = CSP_DIRECTIVES.join('; ');
