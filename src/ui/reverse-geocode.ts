/**
 * Reverse geocoding for `BirthPlaceMap.tsx`'s "Fill in place name" button (#291): turns a
 * Latitude/Longitude pair into a human-readable nearest town/city label for the Place of birth
 * field. Uses Nominatim, OpenStreetMap's free reverse-geocoding service — no API key, matching
 * the zero-config default already used for map tiles (#159, #267). A self-hoster can point this
 * at their own Nominatim instance with `VITE_NOMINATIM_URL`; the server's `ASTRAYA_GEOCODE_ORIGIN`
 * must then grant that same origin in the CSP (`server/csp.ts`), or the request is blocked — see
 * README.md.
 */
const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const rawNominatimUrl: unknown = import.meta.env.VITE_NOMINATIM_URL;
const NOMINATIM_URL =
  typeof rawNominatimUrl === 'string' && rawNominatimUrl !== '' ? rawNominatimUrl : DEFAULT_NOMINATIM_URL;

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

// Ordered by specificity: a `city` is preferred over the wider administrative units Nominatim
// also carries on the same response, and there is no single field name that is always the
// most specific one present — sparsely-populated areas may only have a `county`.
function nearestSettlement(address: NominatimAddress): string | undefined {
  return address.city ?? address.town ?? address.village ?? address.hamlet ?? address.municipality ?? address.county;
}

/**
 * Resolves to `undefined` when Nominatim has no address for the given coordinates (e.g. open
 * ocean) rather than throwing — that is a normal, expected outcome the caller should show as
 * "no place found", not treat as a failure.
 */
export async function reverseGeocode(latitude: number, longitude: number): Promise<string | undefined> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(latitude));
  url.searchParams.set('lon', String(longitude));
  // Town/city level (#291) — finer zoom values resolve to a specific street or building, which
  // is more precision than a birth-place label calls for.
  url.searchParams.set('zoom', '10');
  url.searchParams.set('addressdetails', '1');

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`reverse geocoding request failed: ${String(response.status)}`);

  const data = (await response.json()) as NominatimResponse;
  if (data.address === undefined) return undefined;
  const settlement = nearestSettlement(data.address);
  if (settlement === undefined) return undefined;
  return data.address.country === undefined ? settlement : `${settlement}, ${data.address.country}`;
}
