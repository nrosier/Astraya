/**
 * Tests for the cross-tab write lock (#311).
 *
 * A fake `navigator.locks` stands in for the real Web Locks API: it grants a name to at
 * most one caller at a time and, like the real API's `ifAvailable: true`, resolves the
 * request immediately with a `null` lock rather than queueing when the name is already
 * held. That is the one behaviour this module depends on, so the fake models exactly
 * that and nothing more.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { acquireWriteLock } from '../src/store/tab-lock.js';

interface FakeLockManager {
  request(
    name: string,
    options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: object | null) => Promise<unknown>,
  ): Promise<unknown>;
}

function fakeLocks(): FakeLockManager {
  const held = new Set<string>();
  return {
    async request(name, _options, callback) {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({});
      } finally {
        held.delete(name);
      }
    },
  };
}

/** Install a fake `navigator.locks`, or remove `navigator` entirely. */
function withLocks(locks: unknown): void {
  const target = globalThis as { navigator?: unknown };
  if (locks === null) {
    delete target.navigator;
    return;
  }
  Object.defineProperty(target, 'navigator', { value: { locks }, configurable: true, writable: true });
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

afterEach(() => {
  if (original === undefined) delete (globalThis as { navigator?: unknown }).navigator;
  else Object.defineProperty(globalThis, 'navigator', original);
});

describe('acquiring the write lock', () => {
  it('grants it when nobody else holds it', async () => {
    withLocks(fakeLocks());
    const lock = await acquireWriteLock('astraya-writer:test');
    expect(lock.writable).toBe(true);
    lock.release();
  });

  it('refuses a second tab rather than making it wait', async () => {
    // `ifAvailable: true` is the point: a second tab must find out immediately that it is
    // read-only, not queue behind the first and block whatever called this.
    withLocks(fakeLocks());
    const first = await acquireWriteLock('astraya-writer:test');
    const second = await acquireWriteLock('astraya-writer:test');
    expect(first.writable).toBe(true);
    expect(second.writable).toBe(false);
    first.release();
  });

  it('lets a later tab acquire it once the writer releases', async () => {
    withLocks(fakeLocks());
    const first = await acquireWriteLock('astraya-writer:test');
    first.release();
    // `release()` only resolves the promise the fake's `request` is awaiting; the fake's own
    // bookkeeping (removing the name from `held`) runs as a continuation of that, not
    // synchronously. A real "later tab" is never this immediate, so a macrotask tick — long
    // enough for every pending microtask to drain first — is the honest way to simulate one.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const second = await acquireWriteLock('astraya-writer:test');
    expect(second.writable).toBe(true);
    second.release();
  });

  it('does not let two different stores contend over one lock', async () => {
    withLocks(fakeLocks());
    const a = await acquireWriteLock('astraya-writer:account-a');
    const b = await acquireWriteLock('astraya-writer:account-b');
    expect(a.writable).toBe(true);
    expect(b.writable).toBe(true);
    a.release();
    b.release();
  });

  it('falls back to always-writable when there is no Locks API', async () => {
    withLocks(null);
    const lock = await acquireWriteLock('astraya-writer:test');
    expect(lock.writable).toBe(true);
    // A no-op, not a throw — nothing was ever acquired to release.
    expect(() => {
      lock.release();
    }).not.toThrow();
  });
});
