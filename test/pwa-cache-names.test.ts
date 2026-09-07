/**
 * Tests for versioned Cache Storage names (#99, #100).
 */
import { describe, expect, it } from 'vitest';
import { ephemerisCacheName, shellCacheName, staleCaches } from '../src/pwa/cache-names.js';

describe('cache names', () => {
  it('are distinct per version and per purpose', () => {
    expect(shellCacheName('0.4.0')).not.toBe(shellCacheName('0.5.0'));
    expect(shellCacheName('0.4.0')).not.toBe(ephemerisCacheName('0.4.0'));
  });
});

describe('staleCaches', () => {
  it('keeps the current version out of the stale list', () => {
    const existing = [shellCacheName('0.4.0'), ephemerisCacheName('0.4.0')];
    expect(staleCaches(existing, '0.4.0')).toEqual([]);
  });

  it('flags a previous release as stale, so an upgrade cannot mix its files with the new ones', () => {
    const existing = [shellCacheName('0.3.0'), ephemerisCacheName('0.3.0'), ephemerisCacheName('0.4.0')];
    const stale = staleCaches(existing, '0.4.0');
    expect(stale).toContain(shellCacheName('0.3.0'));
    expect(stale).toContain(ephemerisCacheName('0.3.0'));
    expect(stale).not.toContain(ephemerisCacheName('0.4.0'));
  });

  it('never touches a cache outside this app, even one that shares no name with ours', () => {
    expect(staleCaches(['workbox-precache-v2', 'some-other-origin-cache'], '0.4.0')).toEqual([]);
  });
});
