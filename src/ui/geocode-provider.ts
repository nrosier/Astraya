/**
 * Provider precedence shared by `reverse-geocode.ts` (#291, #294) and `forward-geocode.ts`
 * (#290) — one deployment must resolve both operations to the same backend, so the selection
 * logic lives once rather than twice. Mirrors the tile provider precedence in
 * `BirthPlaceMap.tsx:38-61`:
 *
 * 1. An explicit self-hosted Nominatim-compatible server (a build-time URL, read by the two
 *    callers) → its `/search` endpoint is assumed to live at the same origin as its documented
 *    `/reverse` one, matching Nominatim's own stock API layout. The server's
 *    `ASTRAYA_GEOCODE_ORIGIN` must grant that origin in the CSP (`server/csp.ts`), or requests
 *    are blocked — see README.md.
 * 2. Else a MapTiler Cloud API key → MapTiler's Geocoding API, the same key already used for
 *    tiles (#267). MapTiler authenticates by that key, not by `Referer`, so no referrer is ever
 *    sent to it.
 * 3. Else → the public Nominatim default. No API key, matching the zero-config default already
 *    used for map tiles (#159, #267), but Nominatim only grants CORS to requests that carry a
 *    `Referer` header (confirmed directly against the live server, #294); the server's blanket
 *    `Referrer-Policy: no-referrer` (set for every response) strips it unless the fetch itself
 *    overrides that with `referrerPolicy: 'origin'` — discloses only this site's origin to
 *    Nominatim, mirroring the tile fetch's own override for the identical reason.
 */
const DEFAULT_NOMINATIM_REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse';

const rawNominatimUrl: unknown = import.meta.env.VITE_NOMINATIM_URL;
const explicitNominatimUrl =
  typeof rawNominatimUrl === 'string' && rawNominatimUrl !== '' ? rawNominatimUrl : undefined;

const rawMaptilerApiKey: unknown = import.meta.env.VITE_MAPTILER_API_KEY;
const maptilerApiKey =
  typeof rawMaptilerApiKey === 'string' && rawMaptilerApiKey !== '' ? rawMaptilerApiKey : undefined;

export const usingMaptiler = explicitNominatimUrl === undefined && maptilerApiKey !== undefined;
export const usingDefaultNominatim = explicitNominatimUrl === undefined && maptilerApiKey === undefined;

const NOMINATIM_REVERSE_URL = explicitNominatimUrl ?? DEFAULT_NOMINATIM_REVERSE_URL;
export const NOMINATIM_URL = NOMINATIM_REVERSE_URL;
export const NOMINATIM_SEARCH_URL = `${new URL(NOMINATIM_REVERSE_URL).origin}/search`;

export function maptilerGeocodeUrl(path: string): URL {
  const url = new URL(`https://api.maptiler.com/geocoding/${path}.json`);
  url.searchParams.set('key', maptilerApiKey ?? '');
  return url;
}

// Fires once, only for the true public default (never for a self-hoster's own server, whose
// failures are that deployer's own server to diagnose) — the same diagnostic role
// `warnIfDefaultTileServer` plays in `BirthPlaceMap.tsx` for the identical class of problem.
// Shared by both directions of geocoding: whichever one a visitor happens to hit first is the
// one that gets the console warning, since the underlying cause and fix are the same either way.
let warnedAboutDefaultGeocodeServer = false;
export function warnIfDefaultGeocodeServer(): void {
  if (!usingDefaultNominatim || warnedAboutDefaultGeocodeServer) return;
  warnedAboutDefaultGeocodeServer = true;
  console.warn(
    "Astraya: a request to Nominatim's public geocoding endpoint (the default when neither a " +
      "self-hosted server nor a MapTiler API key is configured) failed. Likely that server's " +
      "own usage-policy enforcement against unidentified or high-volume clients (#267's tile-" +
      'blocking is the same category of restriction), not a defect in this request. Set a ' +
      'MapTiler API key or point at your own Nominatim-compatible server instead: see ' +
      "README.md's geocoding server sections.",
  );
}
