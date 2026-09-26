/**
 * Forward geocoding for `BirthPlaceMap.tsx`'s "search by name" field (#290): turns a free-text
 * place name into one or more candidate coordinates + display names, so a birth place can be
 * found without knowing its Latitude/Longitude up front. Provider selection (self-hosted
 * Nominatim / MapTiler / public Nominatim default) lives in `geocode-provider.ts`, shared with
 * `reverse-geocode.ts` (#291, #294).
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

/**
 * Both providers' response shapes, declared as the *claims* they are rather than as facts.
 *
 * These describe JSON from a third-party server, reached through an `as` cast that checks
 * nothing. Declaring a coordinate as `[number, number]` and then indexing it makes a
 * malformed response an unhandled `TypeError` in the caller's render, instead of the "no
 * results" outcome the caller already knows how to show (#336) — so every field a result
 * is built from is optional here and checked by `candidate` below.
 */
interface MaptilerFeature {
  readonly place_name?: unknown;
  readonly geometry?: { readonly coordinates?: readonly unknown[] };
}

interface MaptilerFeatureCollection {
  readonly features?: readonly MaptilerFeature[];
}

interface NominatimSearchResult {
  readonly lat?: unknown;
  readonly lon?: unknown;
  readonly display_name?: unknown;
}

// How many candidates to offer — a birth-place search rarely needs more than a handful, and the
// result list (click-to-confirm, never auto-picked) stays easy to scan at this size.
const RESULT_LIMIT = 5;

/**
 * A degree value from either provider — MapTiler sends numbers, Nominatim sends strings.
 *
 * Not a bare `Number()`: it maps `null` and `''` to 0, which would place a birth chart on
 * the Gulf of Guinea rather than reporting that the coordinate was missing.
 */
function coordinate(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * One validated candidate, or nothing — `flatMap`'s empty array drops a result this can't
 * read while keeping the others in the same response, which is the useful behaviour: one
 * unparseable entry is not a reason to fail a search that also found three good towns.
 */
function candidate(latitude: unknown, longitude: unknown, displayName: unknown): ForwardGeocodeResult[] {
  const lat = coordinate(latitude);
  const lon = coordinate(longitude);
  if (typeof displayName !== 'string' || lat === undefined || lon === undefined) return [];
  return [{ latitude: lat, longitude: lon, displayName }];
}

/**
 * A response body that should have been a list but might not be — either provider's
 * results, since `candidate` reads both through `unknown` anyway.
 */
function asArray(value: unknown): readonly (MaptilerFeature & NominatimSearchResult)[] {
  return Array.isArray(value) ? (value as readonly (MaptilerFeature & NominatimSearchResult)[]) : [];
}

async function forwardGeocodeViaMaptiler(query: string): Promise<ForwardGeocodeResult[]> {
  const url = maptilerGeocodeUrl(encodeURIComponent(query));
  url.searchParams.set('limit', String(RESULT_LIMIT));

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`place search request failed: ${String(response.status)}`);

  const data = (await response.json()) as MaptilerFeatureCollection;
  // GeoJSON orders a coordinate pair longitude-first.
  return asArray(data.features).flatMap((feature) =>
    candidate(feature.geometry?.coordinates?.[1], feature.geometry?.coordinates?.[0], feature.place_name),
  );
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

  const data: unknown = await response.json();
  return asArray(data).flatMap((result) => candidate(result.lat, result.lon, result.display_name));
}

/**
 * Resolves to an empty array when nothing matches the query, rather than throwing — that is a
 * normal, expected outcome the caller should show as "no results", not treat as a failure.
 */
export async function forwardGeocode(query: string): Promise<ForwardGeocodeResult[]> {
  return usingMaptiler ? forwardGeocodeViaMaptiler(query) : forwardGeocodeViaNominatim(query);
}
