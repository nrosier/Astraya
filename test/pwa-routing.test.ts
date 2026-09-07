/**
 * Tests for the service worker's request classification (#99, #100).
 *
 * The dangerous mistake here is not "the wrong strategy" but "intercepted at
 * all" — a bypassed request behaves as if there were no service worker, so
 * these lean on proving that cross-origin requests, non-GETs and `/api/` all
 * bypass, which is what keeps a future Authentik redirect safe by construction.
 */
import { describe, expect, it } from 'vitest';
import { classify, type RouteRequest } from '../src/pwa/routing.js';

function request(overrides: Partial<RouteRequest> = {}): RouteRequest {
  return { pathname: '/', method: 'GET', sameOrigin: true, mode: 'navigate', ...overrides };
}

describe('classify', () => {
  it('bypasses anything cross-origin, regardless of path', () => {
    expect(classify(request({ sameOrigin: false, pathname: '/ephe/sepl_18.se1' }))).toBe('bypass');
    expect(classify(request({ sameOrigin: false, pathname: '/api/ops' }))).toBe('bypass');
  });

  it('bypasses non-GET requests, so a POST to a future sync endpoint is never cached', () => {
    expect(classify(request({ method: 'POST', pathname: '/api/ops' }))).toBe('bypass');
    expect(classify(request({ method: 'POST', pathname: '/ephe/sepl_18.se1' }))).toBe('bypass');
  });

  it('bypasses /api/, never treating a relay request as cacheable', () => {
    expect(classify(request({ pathname: '/api/ops', mode: 'cors' }))).toBe('bypass');
  });

  it('bypasses /api/ even when the browser treats it as a navigation, e.g. an OIDC redirect callback', () => {
    expect(classify(request({ pathname: '/api/auth/callback', mode: 'navigate' }))).toBe('bypass');
  });

  it('routes ephemeris assets to their own strategy', () => {
    expect(classify(request({ pathname: '/ephe/sepl_18.se1', mode: 'cors' }))).toBe('ephemeris');
    expect(classify(request({ pathname: '/ephe/swisseph.wasm', mode: 'cors' }))).toBe('ephemeris');
  });

  it('routes a navigation request to shell-navigate even for an unknown path', () => {
    // Hash routing means every in-app URL is really "/", so anything the browser
    // treats as a document load must hit the shell cache.
    expect(classify(request({ pathname: '/', mode: 'navigate' }))).toBe('shell-navigate');
  });

  it('routes hashed build assets and icons to shell-asset', () => {
    expect(classify(request({ pathname: '/assets/index-abc123.js', mode: 'no-cors' }))).toBe('shell-asset');
    expect(classify(request({ pathname: '/icons/icon-192.png', mode: 'no-cors' }))).toBe('shell-asset');
    expect(classify(request({ pathname: '/manifest.webmanifest', mode: 'no-cors' }))).toBe('shell-asset');
  });

  it('bypasses a same-origin GET that matches nothing, such as /healthz', () => {
    expect(classify(request({ pathname: '/healthz', mode: 'no-cors' }))).toBe('bypass');
  });
});
