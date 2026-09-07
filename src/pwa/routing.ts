/**
 * Which caching strategy a request gets, decided from the request alone.
 *
 * Pure and framework-free on purpose: the service worker's own `fetch` handler
 * (untestable outside a browser) is reduced to "classify, then dispatch", so the
 * actual decision — the part a bug would hide in — is a plain function with a
 * Vitest suite instead of something only exercisable by installing a real worker.
 */

export type Strategy = 'bypass' | 'ephemeris' | 'shell-asset' | 'shell-navigate';

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
 * the only outcome for cross-origin requests and `/api/`. A future Authentik
 * request is cross-origin by construction, so it never needs its own rule here.
 */
export function classify(request: RouteRequest): Strategy {
  if (!request.sameOrigin || request.method !== 'GET') return 'bypass';
  if (request.pathname.startsWith('/api/')) return 'bypass';
  if (request.pathname.startsWith('/ephe/')) return 'ephemeris';
  if (request.mode === 'navigate') return 'shell-navigate';
  if (SHELL_ASSET_PREFIXES.some((prefix) => request.pathname.startsWith(prefix))) return 'shell-asset';
  if (SHELL_ASSET_PATHS.includes(request.pathname)) return 'shell-asset';
  return 'bypass';
}
