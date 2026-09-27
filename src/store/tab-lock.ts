/**
 * One exclusive writer tab per store (#311).
 *
 * Two tabs of the same origin resolve to the same `deviceId` (see `deviceIdFor`
 * in `store.ts`) but each builds its own in-memory `Clock`. Nothing stops both
 * from minting an HLC at the same moment, and nothing merges the two clocks —
 * so two tabs writing "concurrently" can produce colliding HLCs, silently
 * overwriting each other's operations. Rather than attempt to merge two
 * independent clocks, exactly one tab is allowed to write; every other tab
 * is read-only until the writer tab closes (or itself gives up the lock).
 */

export interface TabLock {
  /** False when another tab already holds this lock. */
  readonly writable: boolean;
  /** Frees the lock immediately, rather than waiting for the tab to unload. */
  release(): void;
}

/**
 * The Web Locks API as it actually exists, rather than as `lib.dom` describes
 * it — absent in the test environment and in browsers old enough to lack it.
 * Feature-detected the same way `storageManager()` is in `persist.ts`.
 */
function locksApi(): LockManager | undefined {
  return (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
}

/**
 * Requests an exclusive lock named `name` and reports whether it was granted.
 *
 * No `navigator.locks` here (older browser, or a test environment) means no
 * cross-tab coordination is possible at all — falling back to always-writable
 * is today's behaviour, not a new risk, since this is a hardening fix for
 * browsers that do have the API.
 *
 * `ifAvailable: true` makes the request resolve immediately with a `null`
 * lock when another tab already holds it, rather than queueing behind it —
 * this tab should find out right away that it is read-only, not block.
 */
export async function acquireWriteLock(name: string): Promise<TabLock> {
  const locks = locksApi();
  if (!locks) return { writable: true, release: () => undefined };

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  const writable = await new Promise<boolean>((resolveGranted) => {
    // The lock is held for as long as the callback's returned promise is
    // pending, so `held` (resolved only by calling `release`) is what keeps
    // it open; `resolveGranted` reports the outcome without waiting for that.
    void locks.request(name, { mode: 'exclusive', ifAvailable: true }, (lock) => {
      resolveGranted(lock !== null);
      return held;
    });
  });

  return { writable, release };
}
