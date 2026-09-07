/**
 * Cache Storage names, scoped to a release version.
 *
 * Versioning the name rather than the contents is what makes eviction trivial:
 * an old release's cache is just a name that is no longer current, so cleanup on
 * `activate` is "delete anything with our prefix that isn't one of these two"
 * rather than tracking what is inside each cache.
 */

const PREFIX = 'astraya';

export function shellCacheName(version: string): string {
  return `${PREFIX}-shell-${version}`;
}

/**
 * Its own cache, separate from the shell: an upgrade must not let a new
 * `swisseph.wasm` read data files left behind by the previous release, or a
 * position comes back wrong with nothing to say why (#100).
 */
export function ephemerisCacheName(version: string): string {
  return `${PREFIX}-ephemeris-${version}`;
}

/**
 * Every existing cache name that belongs to this app but not to `version`.
 *
 * Filtered to our own prefix so this can never touch a cache something else put
 * in the same origin's Cache Storage.
 */
export function staleCaches(existing: readonly string[], version: string): readonly string[] {
  const current = new Set([shellCacheName(version), ephemerisCacheName(version)]);
  return existing.filter((name) => name.startsWith(`${PREFIX}-`) && !current.has(name));
}
