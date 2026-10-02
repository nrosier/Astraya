/**
 * Which caching strategy a request gets, decided from the request alone.
 *
 * Pure and framework-free on purpose: the service worker's own `fetch` handler
 * (untestable outside a browser) is reduced to "classify, then dispatch", so the
 * actual decision — the part a bug would hide in — is a plain function with a
 * Vitest suite instead of something only exercisable by installing a real worker.
 *
 * The OIDC callback path (`src/ui/oidc-pkce.ts`'s `OIDC_CALLBACK_PATH`) is hardcoded here rather
 * than imported: this file is bundled into the service worker (via `sw-core.ts`), which must
 * never pull in `src/ui/` — a layering boundary this directory otherwise has nothing crossing.
 * Keep the two in sync by hand if the path ever changes.
 */

export type Strategy = 'bypass' | 'ephemeris' | 'shell-asset' | 'shell-navigate';

/** Matches `oidc-pkce.ts`'s `OIDC_CALLBACK_PATH` — never cache this: the query string carries a single-use OAuth authorization code and state, which must never land in durable Cache Storage (#383). */
const OIDC_CALLBACK_PATH = '/auth/oidc/callback';

export interface RouteRequest {
  readonly pathname: string;
  readonly method: string;
  readonly sameOrigin: boolean;
  /** `Request.mode` — `'navigate'` for a document load, distinguishing it from a fetch for a script or a stylesheet. */
  readonly mode: string;
}

const SHELL_ASSET_PREFIXES = ['/assets/', '/icons/'] as const;
const SHELL_ASSET_PATHS: readonly string[] = ['/manifest.webmanifest'];

/**
 * `bypass` means "let the browser handle this as if there were no service
 * worker" — the only safe default for anything not explicitly recognised, and
 * the only outcome for cross-origin requests, `/api/`, and the OIDC callback
 * (its query string carries a single-use authorization code and state, which
 * must never be written into durable Cache Storage, #383). A future Authentik
 * request is cross-origin by construction, so it never needs its own rule here.
 */
export function classify(request: RouteRequest): Strategy {
  if (!request.sameOrigin || request.method !== 'GET') return 'bypass';
  if (request.pathname.startsWith('/api/')) return 'bypass';
  if (request.pathname === OIDC_CALLBACK_PATH) return 'bypass';
  if (request.pathname.startsWith('/ephe/')) return 'ephemeris';
  if (request.mode === 'navigate') return 'shell-navigate';
  if (SHELL_ASSET_PREFIXES.some((prefix) => request.pathname.startsWith(prefix))) return 'shell-asset';
  if (SHELL_ASSET_PATHS.includes(request.pathname)) return 'shell-asset';
  return 'bypass';
}
