/**
 * `src/ui/forward-geocode.ts` (#290): a plain `fetch()` wrapper around Nominatim or MapTiler,
 * mocked here rather than hit for real — real calls in a test suite would be flaky
 * (rate-limited) and a policy violation in CI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { forwardGeocode } from '../src/ui/forward-geocode.ts';

const realFetch = globalThis.fetch;
let lastRequestUrl: URL | undefined;
let lastRequestInit: RequestInit | undefined;

function mockFetch(body: unknown, init: { ok?: boolean; status?: number } = {}): void {
  globalThis.fetch = async (input, requestInit) => {
    lastRequestUrl = new URL(input instanceof Request ? input.url : String(input));
    lastRequestInit = requestInit;
    return new Response(JSON.stringify(body), { status: init.ok === false ? (init.status ?? 500) : 200 });
  };
}

beforeEach(() => {
  lastRequestUrl = undefined;
  lastRequestInit = undefined;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('forwardGeocode', () => {
  it('maps each Nominatim result to coordinates and a display name', async () => {
    mockFetch([
      { lat: '48.8566', lon: '2.3522', display_name: 'Paris, Île-de-France, France' },
      { lat: '33.6609', lon: '-95.5555', display_name: 'Paris, Texas, United States' },
    ]);
    expect(await forwardGeocode('Paris')).toEqual([
      { latitude: 48.8566, longitude: 2.3522, displayName: 'Paris, Île-de-France, France' },
      { latitude: 33.6609, longitude: -95.5555, displayName: 'Paris, Texas, United States' },
    ]);
  });

  it('resolves to an empty array when nothing matches', async () => {
    mockFetch([]);
    expect(await forwardGeocode('Nowhereville')).toEqual([]);
  });

  it('throws when the request fails', async () => {
    mockFetch([], { ok: false, status: 503 });
    await expect(forwardGeocode('Paris')).rejects.toThrow('503');
  });

  it('requests jsonv2 format, the query and a result limit, against the /search endpoint', async () => {
    mockFetch([]);
    await forwardGeocode('Paris');
    expect(lastRequestUrl?.pathname).toBe('/search');
    expect(lastRequestUrl?.searchParams.get('format')).toBe('jsonv2');
    expect(lastRequestUrl?.searchParams.get('q')).toBe('Paris');
    expect(lastRequestUrl?.searchParams.get('limit')).toBe('5');
  });

  it('sends a referrer to Nominatim despite the app-wide no-referrer policy (#294)', async () => {
    mockFetch([]);
    await forwardGeocode('Paris');
    expect(lastRequestInit?.referrerPolicy).toBe('origin');
  });
});

describe('forwardGeocode, with a MapTiler API key configured (#294)', () => {
  it('maps each MapTiler feature to coordinates and a display name, sending no referrer override', async () => {
    vi.stubEnv('VITE_MAPTILER_API_KEY', 'test-key');
    vi.resetModules();
    const { forwardGeocode: forwardGeocodeWithMaptiler } = await import('../src/ui/forward-geocode.ts');
    mockFetch({
      features: [{ place_name: 'Paris, Île-de-France, France', geometry: { coordinates: [2.3522, 48.8566] } }],
    });
    expect(await forwardGeocodeWithMaptiler('Paris')).toEqual([
      { latitude: 48.8566, longitude: 2.3522, displayName: 'Paris, Île-de-France, France' },
    ]);
    expect(lastRequestUrl?.hostname).toBe('api.maptiler.com');
    expect(lastRequestUrl?.searchParams.get('key')).toBe('test-key');
    expect(lastRequestInit?.referrerPolicy).toBeUndefined();
  });

  it('resolves to an empty array when there are no features', async () => {
    vi.stubEnv('VITE_MAPTILER_API_KEY', 'test-key');
    vi.resetModules();
    const { forwardGeocode: forwardGeocodeWithMaptiler } = await import('../src/ui/forward-geocode.ts');
    mockFetch({ features: [] });
    expect(await forwardGeocodeWithMaptiler('Nowhereville')).toEqual([]);
  });

  it('throws when the request fails', async () => {
    vi.stubEnv('VITE_MAPTILER_API_KEY', 'test-key');
    vi.resetModules();
    const { forwardGeocode: forwardGeocodeWithMaptiler } = await import('../src/ui/forward-geocode.ts');
    mockFetch({}, { ok: false, status: 403 });
    await expect(forwardGeocodeWithMaptiler('Paris')).rejects.toThrow('403');
  });
});
