/**
 * Reverse geocoding for `BirthPlaceMap.tsx`'s "Fill in place name" button (#291): turns a
 * Latitude/Longitude pair into a human-readable nearest town/city label for the Place of birth
 * field. Two backends, same precedence order as the tile provider selection above it
 * (`VITE_TILE_URL_TEMPLATE` / `VITE_MAPTILER_API_KEY` / default, `BirthPlaceMap.tsx:38-61`):
 *
 * 1. `VITE_NOMINATIM_URL` set → a self-hosted Nominatim-compatible server. The server's
 *    `ASTRAYA_GEOCODE_ORIGIN` must grant that same origin in the CSP (`server/csp.ts`), or the
 *    request is blocked — see README.md.
 * 2. Else `VITE_MAPTILER_API_KEY` set → MapTiler's Geocoding API, the same key already used for
 *    tiles (#267). MapTiler authenticates by that key, not by `Referer`, so no referrer is ever
 *    sent to it (#294) — unlike Nominatim below.
 * 3. Else → the public Nominatim default. No API key, matching the zero-config default already
 *    used for map tiles (#159, #267), but Nominatim only grants CORS to requests that carry a
 *    `Referer` header (confirmed directly against the live server, #294); the server's blanket
 *    `Referrer-Policy: no-referrer` (set for every response) strips it unless the fetch itself
 *    overrides that, hence `referrerPolicy: 'origin'` below — discloses only this site's origin
 *    to Nominatim, mirroring the tile fetch's own override for the identical reason.
 */
const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const rawNominatimUrl: unknown = import.meta.env.VITE_NOMINATIM_URL;
const explicitNominatimUrl =
  typeof rawNominatimUrl === 'string' && rawNominatimUrl !== '' ? rawNominatimUrl : undefined;

const rawMaptilerApiKey: unknown = import.meta.env.VITE_MAPTILER_API_KEY;
const maptilerApiKey =
  typeof rawMaptilerApiKey === 'string' && rawMaptilerApiKey !== '' ? rawMaptilerApiKey : undefined;

const usingMaptiler = explicitNominatimUrl === undefined && maptilerApiKey !== undefined;
const usingDefaultNominatim = explicitNominatimUrl === undefined && maptilerApiKey === undefined;
const NOMINATIM_URL = explicitNominatimUrl ?? DEFAULT_NOMINATIM_URL;

interface NominatimAddress {
  readonly city?: string;
  readonly town?: string;
  readonly village?: string;
  readonly hamlet?: string;
  readonly municipality?: string;
  readonly county?: string;
  readonly country?: string;
}

interface NominatimResponse {
  readonly address?: NominatimAddress;
}

interface MaptilerFeature {
  readonly place_name?: string;
}

interface MaptilerFeatureCollection {
  readonly features: MaptilerFeature[];
}

// Ordered by specificity: a `city` is preferred over the wider administrative units Nominatim
// also carries on the same response, and there is no single field name that is always the
// most specific one present — sparsely-populated areas may only have a `county`.
function nearestSettlement(address: NominatimAddress): string | undefined {
  return address.city ?? address.town ?? address.village ?? address.hamlet ?? address.municipality ?? address.county;
}

// Fires once, only for the true public default (never for a self-hoster's own server, whose
// failures are that deployer's own server to diagnose) — the same diagnostic role
// `warnIfDefaultTileServer` plays in `BirthPlaceMap.tsx` for the identical class of problem.
let warnedAboutDefaultGeocodeServer = false;
function warnIfDefaultGeocodeServer(): void {
  if (!usingDefaultNominatim || warnedAboutDefaultGeocodeServer) return;
  warnedAboutDefaultGeocodeServer = true;
  console.warn(
    "Astraya: a request to Nominatim's public reverse-geocoding endpoint (the default when " +
      "neither VITE_NOMINATIM_URL nor VITE_MAPTILER_API_KEY is set) failed. Likely that server's " +
      "own usage-policy enforcement against unidentified or high-volume clients (#267's tile-" +
      'blocking is the same category of restriction), not a defect in this request. Set a ' +
      'MapTiler API key or point at your own Nominatim-compatible server instead: see ' +
      "README.md's geocoding server sections.",
  );
}

async function reverseGeocodeViaMaptiler(latitude: number, longitude: number): Promise<string | undefined> {
  const url = new URL(`https://api.maptiler.com/geocoding/${longitude},${latitude}.json`);
  url.searchParams.set('key', maptilerApiKey ?? '');
  url.searchParams.set('limit', '1');

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`reverse geocoding request failed: ${String(response.status)}`);

  const data = (await response.json()) as MaptilerFeatureCollection;
  return data.features[0]?.place_name;
}

async function reverseGeocodeViaNominatim(latitude: number, longitude: number): Promise<string | undefined> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  // Town/city level (#291) — finer zoom values resolve to a specific street or building, which
  // is more precision than a birth-place label calls for.
  url.searchParams.set('zoom', '10');
  url.searchParams.set('addressdetails', '1');

  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, referrerPolicy: 'origin' });
  } catch (error) {
    warnIfDefaultGeocodeServer();
    throw error;
  }
  if (!response.ok) {
    warnIfDefaultGeocodeServer();
    throw new Error(`reverse geocoding request failed: ${String(response.status)}`);
  }

  const data = (await response.json()) as NominatimResponse;
  if (data.address === undefined) return undefined;
  const settlement = nearestSettlement(data.address);
  if (settlement === undefined) return undefined;
  return data.address.country === undefined ? settlement : `${settlement}, ${data.address.country}`;
}

/**
 * Resolves to `undefined` when the geocoder has no address for the given coordinates (e.g. open
 * ocean) rather than throwing — that is a normal, expected outcome the caller should show as
 * "no place found", not treat as a failure.
 */
export async function reverseGeocode(latitude: number, longitude: number): Promise<string | undefined> {
  return usingMaptiler
    ? reverseGeocodeViaMaptiler(latitude, longitude)
    : reverseGeocodeViaNominatim(latitude, longitude);
}
