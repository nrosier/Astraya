/**
 * Provider precedence for `forward-geocode.ts` (#290), used by `BirthPlaceSearch.tsx`'s
 * "Search for a place by name" field — the sole way this app resolves a place name to
 * coordinates:
 *
 * 1. An explicit self-hosted Nominatim-compatible server (a build-time origin) → its `/search`
 *    endpoint, matching Nominatim's own stock API layout. The server's `ASTRAYA_GEOCODE_ORIGIN`
 *    must grant that origin in the CSP (`server/csp.ts`), or requests are blocked — see README.md.
 * 2. Else a MapTiler Cloud API key → MapTiler's Geocoding API. MapTiler authenticates by that
 *    key, not by `Referer`, so no referrer is ever sent to it.
 * 3. Else → the public Nominatim default. No API key required, but Nominatim only grants CORS
 *    to requests that carry a `Referer` header (confirmed directly against the live server,
 *    #294); the server's blanket `Referrer-Policy: no-referrer` (set for every response) strips
 *    it unless the fetch itself overrides that with `referrerPolicy: 'origin'` — discloses only
 *    this site's origin to Nominatim, never the full page URL.
 */
const DEFAULT_NOMINATIM_ORIGIN = 'https://nominatim.openstreetmap.org';

const rawNominatimUrl: unknown = import.meta.env.VITE_NOMINATIM_URL;
const explicitNominatimUrl =
  typeof rawNominatimUrl === 'string' && rawNominatimUrl !== '' ? rawNominatimUrl : undefined;

const rawMaptilerApiKey: unknown = import.meta.env.VITE_MAPTILER_API_KEY;
const maptilerApiKey =
  typeof rawMaptilerApiKey === 'string' && rawMaptilerApiKey !== '' ? rawMaptilerApiKey : undefined;

export const usingMaptiler = explicitNominatimUrl === undefined && maptilerApiKey !== undefined;
export const usingDefaultNominatim = explicitNominatimUrl === undefined && maptilerApiKey === undefined;

const nominatimOrigin =
  explicitNominatimUrl === undefined ? DEFAULT_NOMINATIM_ORIGIN : new URL(explicitNominatimUrl).origin;
export const NOMINATIM_SEARCH_URL = `${nominatimOrigin}/search`;

export function maptilerGeocodeUrl(path: string): URL {
  const url = new URL(`https://api.maptiler.com/geocoding/${path}.json`);
  url.searchParams.set('key', maptilerApiKey ?? '');
  return url;
}

// Fires once, only for the true public default (never for a self-hoster's own server, whose
// failures are that deployer's own server to diagnose).
let warnedAboutDefaultGeocodeServer = false;
export function warnIfDefaultGeocodeServer(): void {
  if (!usingDefaultNominatim || warnedAboutDefaultGeocodeServer) return;
  warnedAboutDefaultGeocodeServer = true;
  console.warn(
    "Astraya: a request to Nominatim's public geocoding endpoint (the default when neither a " +
      "self-hosted server nor a MapTiler API key is configured) failed. Likely that server's " +
      'own usage-policy enforcement against unidentified or high-volume clients, not a defect ' +
      'in this request. Set a MapTiler API key or point at your own Nominatim-compatible server ' +
      "instead: see README.md's geocoding server section.",
  );
}
