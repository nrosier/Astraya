/**
 * Tests for the persistence request (#98).
 *
 * The interesting cases are all the unhappy ones, because the happy one is a single
 * boolean. What matters is that a browser which cannot answer is never reported as
 * having said yes: for a local-only user, "persisted" is a promise that their only copy
 * of their data will survive, and claiming it falsely is worse than warning needlessly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { persistenceWarning, requestPersistence } from '../src/store/persist.js';

/** Install a fake `navigator.storage`, or remove `navigator` entirely. */
function withStorage(storage: unknown): void {
  const target = globalThis as { navigator?: unknown };
  if (storage === null) {
    delete target.navigator;
    return;
  }
  Object.defineProperty(target, 'navigator', { value: { storage }, configurable: true, writable: true });
}

const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

afterEach(() => {
  if (original === undefined) delete (globalThis as { navigator?: unknown }).navigator;
  else Object.defineProperty(globalThis, 'navigator', original);
});

describe('requesting persistence', () => {
  it('reports persisted when the browser grants it', async () => {
    const persist = vi.fn().mockResolvedValue(true);
    withStorage({ persisted: vi.fn().mockResolvedValue(false), persist, estimate: undefined });
    expect((await requestPersistence()).state).toBe('persisted');
    expect(persist).toHaveBeenCalledOnce();
  });

  it('does not ask again when it is already granted', async () => {
    // Firefox prompts. Asking on every load for something already granted would put a
    // dialog in front of the user for no reason.
    const persist = vi.fn().mockResolvedValue(true);
    withStorage({ persisted: vi.fn().mockResolvedValue(true), persist });
    expect((await requestPersistence()).state).toBe('persisted');
    expect(persist).not.toHaveBeenCalled();
  });

  it('reports evictable when the browser declines', async () => {
    withStorage({ persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockResolvedValue(false) });
    expect((await requestPersistence()).state).toBe('evictable');
  });

  it('reports unsupported rather than granted when there is no persist method', async () => {
    // Safari: `navigator.storage` exists, `persist` does not. Detecting the object alone
    // would report a granted state nobody ever asked for — the exact false promise this
    // module exists to avoid.
    withStorage({ estimate: vi.fn().mockResolvedValue({ usage: 1, quota: 2 }) });
    expect((await requestPersistence()).state).toBe('unsupported');
  });

  it('reports unsupported when only half the Storage API is there', async () => {
    // No shipping browser exposes `persist` without `persisted`, so this is about which way
    // to fail in an environment we do not recognise. Over-warning is the safe direction:
    // asking without being able to check first would either re-prompt a user who already
    // said yes, or report a grant we could not verify.
    withStorage({ persist: vi.fn().mockResolvedValue(true) });
    expect((await requestPersistence()).state).toBe('unsupported');
  });

  it('reports unsupported when there is no navigator at all', async () => {
    withStorage(null);
    expect(await requestPersistence()).toStrictEqual({ state: 'unsupported' });
  });

  it('treats a thrown request as evictable, not as a refusal we can explain', async () => {
    withStorage({
      persisted: vi.fn().mockRejectedValue(new Error('nope')),
      persist: vi.fn(),
      estimate: vi.fn().mockResolvedValue({ usage: 10, quota: 20 }),
    });
    const result = await requestPersistence();
    expect(result.state).toBe('evictable');
    // Still measured: the numbers are independent of whether the request worked.
    expect(result.usageBytes).toBe(10);
  });
});

describe('measuring the store', () => {
  it('carries usage and quota when the browser reports them', async () => {
    withStorage({
      persisted: vi.fn().mockResolvedValue(true),
      persist: vi.fn(),
      estimate: vi.fn().mockResolvedValue({ usage: 4096, quota: 1_000_000 }),
    });
    expect(await requestPersistence()).toEqual({ state: 'persisted', usageBytes: 4096, quotaBytes: 1_000_000 });
  });

  it('omits the fields rather than guessing when the browser will not say', async () => {
    // `exactOptionalPropertyTypes` is doing real work here: an absent field means "not
    // reported", and a `usageBytes: undefined` that rendered as "0 bytes used" would be a
    // different claim entirely.
    withStorage({
      persisted: vi.fn().mockResolvedValue(true),
      persist: vi.fn(),
      estimate: vi.fn().mockResolvedValue({}),
    });
    expect(await requestPersistence()).toStrictEqual({ state: 'persisted' });
  });

  it('still reports the state when estimating throws', async () => {
    withStorage({
      persisted: vi.fn().mockResolvedValue(true),
      persist: vi.fn(),
      estimate: vi.fn().mockRejectedValue(new Error('denied')),
    });
    expect(await requestPersistence()).toStrictEqual({ state: 'persisted' });
  });
});

describe('what the user is told', () => {
  it('says nothing when the data is safe', () => {
    expect(persistenceWarning({ state: 'persisted' })).toBeUndefined();
  });

  it('names the risk and the way out for every state that carries one', () => {
    for (const state of ['evictable', 'unsupported'] as const) {
      const warning = persistenceWarning({ state });
      expect(warning).toBeDefined();
      // The mitigation is the point of the message. A warning that only says data may be
      // lost leaves the user with nothing to do about it.
      expect(warning).toMatch(/export/i);
      expect(warning).toMatch(/this device/i);
    }
  });

  it('does not tell a Safari user they refused something they were never asked', () => {
    expect(persistenceWarning({ state: 'unsupported' })).not.toMatch(/refus|declin/i);
  });
});
