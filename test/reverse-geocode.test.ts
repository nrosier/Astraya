/**
 * `src/ui/reverse-geocode.ts` (#291, #294): a plain `fetch()` wrapper around Nominatim or
 * MapTiler, mocked here rather than hit for real — the same reasoning `e2e/birth-place-map.spec.ts`
 * gives for stubbing OSM's tile host applies equally here: real calls in a test suite would be
 * flaky (rate-limited) and a policy violation in CI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reverseGeocode } from '../src/ui/reverse-geocode.ts';

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

describe('reverseGeocode', () => {
  it('prefers city over wider administrative units', async () => {
    mockFetch({ address: { city: 'Paris', county: 'Île-de-France', country: 'France' } });
    expect(await reverseGeocode(48.8566, 2.3522)).toBe('Paris, France');
  });

  it('falls back through town, village, hamlet and municipality when city is absent', async () => {
    mockFetch({ address: { hamlet: 'Some Hamlet', country: 'Testland' } });
    expect(await reverseGeocode(0, 0)).toBe('Some Hamlet, Testland');
  });

  it('falls back to a county when no settlement-level field is present', async () => {
    mockFetch({ address: { county: 'Remote County', country: 'Testland' } });
    expect(await reverseGeocode(0, 0)).toBe('Remote County, Testland');
  });

  it('omits the country when Nominatim does not return one', async () => {
    mockFetch({ address: { city: 'Somewhere' } });
    expect(await reverseGeocode(0, 0)).toBe('Somewhere');
  });

  it('resolves to undefined when there is no address at all (e.g. open ocean)', async () => {
    mockFetch({});
    expect(await reverseGeocode(0, 0)).toBeUndefined();
  });

  it('resolves to undefined when the address has no usable settlement or county name', async () => {
    mockFetch({ address: { country: 'Testland' } });
    expect(await reverseGeocode(0, 0)).toBeUndefined();
  });

  it('throws when the request fails', async () => {
    mockFetch({}, { ok: false, status: 503 });
    await expect(reverseGeocode(0, 0)).rejects.toThrow('503');
  });

  it('requests jsonv2 format, town/city zoom, and address details, for the given coordinates', async () => {
    mockFetch({ address: { city: 'Paris' } });
    await reverseGeocode(48.8566, 2.3522);
    expect(lastRequestUrl?.searchParams.get('format')).toBe('jsonv2');
    expect(lastRequestUrl?.searchParams.get('lat')).toBe('48.8566');
    expect(lastRequestUrl?.searchParams.get('lon')).toBe('2.3522');
    expect(lastRequestUrl?.searchParams.get('zoom')).toBe('10');
    expect(lastRequestUrl?.searchParams.get('addressdetails')).toBe('1');
  });

  it('sends a referrer to Nominatim despite the app-wide no-referrer policy (#294)', async () => {
    mockFetch({ address: { city: 'Paris' } });
    await reverseGeocode(48.8566, 2.3522);
    expect(lastRequestInit?.referrerPolicy).toBe('origin');
  });
});

describe('reverseGeocode, with a MapTiler API key configured (#294)', () => {
  it("resolves to the top result's place name, sending no referrer override", async () => {
    vi.stubEnv('VITE_MAPTILER_API_KEY', 'test-key');
    vi.resetModules();
    const { reverseGeocode: reverseGeocodeWithMaptiler } = await import('../src/ui/reverse-geocode.ts');
    mockFetch({ features: [{ place_name: 'Paris, Île-de-France, France' }] });
    expect(await reverseGeocodeWithMaptiler(48.8566, 2.3522)).toBe('Paris, Île-de-France, France');
    expect(lastRequestUrl?.hostname).toBe('api.maptiler.com');
    expect(lastRequestUrl?.searchParams.get('key')).toBe('test-key');
    expect(lastRequestInit?.referrerPolicy).toBeUndefined();
  });

  it('resolves to undefined when there are no features', async () => {
    vi.stubEnv('VITE_MAPTILER_API_KEY', 'test-key');
    vi.resetModules();
    const { reverseGeocode: reverseGeocodeWithMaptiler } = await import('../src/ui/reverse-geocode.ts');
    mockFetch({ features: [] });
    expect(await reverseGeocodeWithMaptiler(0, 0)).toBeUndefined();
  });

  it('throws when the request fails', async () => {
    vi.stubEnv('VITE_MAPTILER_API_KEY', 'test-key');
    vi.resetModules();
    const { reverseGeocode: reverseGeocodeWithMaptiler } = await import('../src/ui/reverse-geocode.ts');
    mockFetch({}, { ok: false, status: 403 });
    await expect(reverseGeocodeWithMaptiler(0, 0)).rejects.toThrow('403');
  });
});
