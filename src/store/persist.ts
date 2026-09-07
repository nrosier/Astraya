/**
 * Ask the browser not to throw the user's data away (#98).
 *
 * For a user who never signs in, IndexedDB holds the *only* copy of every person and
 * chart they have entered. Browsers are entitled to evict an origin's storage under
 * disk pressure, and Safari clears it outright after roughly seven days without a
 * visit. Neither shows the user a warning; the app simply comes back empty.
 *
 * `navigator.storage.persist()` asks for exemption. What the answer means is not
 * uniform, which is why this module reports a status rather than a boolean:
 *
 *   - Chromium grants it silently based on engagement — installing the PWA or
 *     bookmarking it usually flips it, and there is nothing useful to tell the user
 *     beyond that.
 *   - Firefox prompts, so a refusal is a decision the user made and may want to revisit.
 *   - Safari does not implement it at all, so the honest answer is "we asked and cannot
 *     find out", not "granted".
 *
 * The point of a refusal is never to block anything. It is to make the one mitigation
 * that always works — export a copy — visible *before* the data is gone rather than
 * after.
 */

export type PersistenceState =
  /** The browser has promised not to evict this origin without asking. */
  | 'persisted'
  /** Asked and declined; the store is evictable. Offer an export. */
  | 'evictable'
  /** No Storage API here. Treat as evictable, but do not claim the user refused. */
  | 'unsupported';

export interface Persistence {
  readonly state: PersistenceState;
  /** Bytes IndexedDB reports using, when the browser will say. */
  readonly usageBytes?: number;
  /** Bytes the origin may use before writes start failing, when the browser will say. */
  readonly quotaBytes?: number;
}

/**
 * The Storage API as it actually exists, rather than as the DOM types describe it.
 *
 * `lib.dom` declares `navigator.storage` and all three of its methods as always
 * present, which is not true of Safari and not true of the test environment. Typing it
 * as partial here is what makes the feature detection below meaningful rather than
 * dead code the linter is right to flag.
 */
type PartialStorage = Partial<StorageManager>;

function storageManager(): PartialStorage | undefined {
  return (globalThis as { navigator?: { storage?: PartialStorage } }).navigator?.storage;
}

/**
 * Request persistence, or report why we could not.
 *
 * Calls `persisted()` first: on Chromium a repeat `persist()` is cheap, but a browser
 * that prompts should not prompt again on every load for something already granted.
 */
export async function requestPersistence(): Promise<Persistence> {
  const storage = storageManager();
  // Feature-detected per method rather than per object: `storage` exists in Safari but
  // without `persist`, so testing the object alone would report a granted state that
  // was never asked for.
  if (storage?.persist === undefined || storage.persisted === undefined) {
    return { state: 'unsupported' };
  }

  let granted: boolean;
  try {
    granted = (await storage.persisted()) || (await storage.persist());
  } catch {
    // A rejected promise here is a browser quirk, not a user decision. Reporting
    // 'evictable' is the safe direction: it over-warns rather than over-promises.
    return { state: 'evictable', ...(await measure(storage)) };
  }

  return { state: granted ? 'persisted' : 'evictable', ...(await measure(storage)) };
}

/**
 * How much room there is.
 *
 * Reported as a courtesy, not a guard. Quotas are deliberately fuzzed by browsers for
 * fingerprinting reasons, so this must never be used to decide whether a write will
 * fit — the transaction aborting is the only reliable answer to that, which is why
 * `db.ts` waits for the commit.
 */
async function measure(storage: PartialStorage): Promise<{ usageBytes?: number; quotaBytes?: number }> {
  try {
    // No `estimate === undefined` guard: calling a method a browser does not implement
    // throws, and the catch below already reports "not measurable". A second check for the
    // same outcome would only be a second thing to get wrong.
    const { usage, quota } = (await storage.estimate?.()) ?? {};
    return {
      ...(typeof usage === 'number' ? { usageBytes: usage } : {}),
      ...(typeof quota === 'number' ? { quotaBytes: quota } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * What to tell the user, in their terms.
 *
 * Kept beside the request so the wording cannot drift from the state it describes,
 * and returning `undefined` for the good case so a caller cannot accidentally render
 * a reassurance nobody asked for.
 */
export function persistenceWarning(persistence: Persistence): string | undefined {
  switch (persistence.state) {
    case 'persisted':
      return undefined;
    case 'evictable':
      return 'This browser may delete Astraya’s stored data if the device runs low on space. Your charts are only on this device, so export a copy — or sign in to sync — if you want to keep them.';
    case 'unsupported':
      return 'This browser will not promise to keep Astraya’s stored data, and Safari clears it after about a week without a visit. Your charts are only on this device, so export a copy if you want to keep them.';
  }
}
