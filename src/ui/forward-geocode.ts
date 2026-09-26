/**
 * Forward geocoding for `BirthPlaceSearch.tsx`'s "search by name" field (#290): turns a free-text
 * place name into one or more candidate coordinates + display names, so a birth place can be
 * found without knowing its Latitude/Longitude up front. Provider selection (self-hosted
 * Nominatim / MapTiler / public Nominatim default) lives in `geocode-provider.ts` (#291, #294).
 */
import {
  maptilerGeocodeUrl,
  NOMINATIM_SEARCH_URL,
  usingMaptiler,
  warnIfDefaultGeocodeServer,
} from './geocode-provider.js';

export interface ForwardGeocodeResult {
  readonly latitude: number;
  readonly longitude: number;
  readonly displayName: string;
}

interface MaptilerFeature {
  readonly place_name?: string;
  readonly geometry: { readonly coordinates: [number, number] };
}

interface MaptilerFeatureCollection {
  readonly features: MaptilerFeature[];
}

interface NominatimSearchResult {
  readonly lat: string;
  readonly lon: string;
  readonly display_name?: string;
}

// How many candidates to offer — a birth-place search rarely needs more than a handful, and the
// result list (click-to-confirm, never auto-picked) stays easy to scan at this size.
const RESULT_LIMIT = 5;

async function forwardGeocodeViaMaptiler(query: string): Promise<ForwardGeocodeResult[]> {
  const url = maptilerGeocodeUrl(encodeURIComponent(query));
  url.searchParams.set('limit', String(RESULT_LIMIT));

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`place search request failed: ${String(response.status)}`);

  const data = (await response.json()) as MaptilerFeatureCollection;
  return data.features
    .filter((feature) => feature.place_name !== undefined)
    .map((feature) => ({
      latitude: feature.geometry.coordinates[1],
      longitude: feature.geometry.coordinates[0],
      // The filter above guarantees this, but TypeScript can't see through it.
      displayName: feature.place_name ?? '',
    }));
}

async function forwardGeocodeViaNominatim(query: string): Promise<ForwardGeocodeResult[]> {
  const url = new URL(NOMINATIM_SEARCH_URL);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(RESULT_LIMIT));

  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, referrerPolicy: 'origin' });
  } catch (error) {
    warnIfDefaultGeocodeServer();
    throw error;
  }
  if (!response.ok) {
    warnIfDefaultGeocodeServer();
    throw new Error(`place search request failed: ${String(response.status)}`);
  }

  const data = (await response.json()) as NominatimSearchResult[];
  return data
    .filter((result) => result.display_name !== undefined)
    .map((result) => ({
      latitude: Number(result.lat),
      longitude: Number(result.lon),
      displayName: result.display_name ?? '',
    }));
}

/**
 * Resolves to an empty array when nothing matches the query, rather than throwing — that is a
 * normal, expected outcome the caller should show as "no results", not treat as a failure.
 */
export async function forwardGeocode(query: string): Promise<ForwardGeocodeResult[]> {
  return usingMaptiler ? forwardGeocodeViaMaptiler(query) : forwardGeocodeViaNominatim(query);
}
