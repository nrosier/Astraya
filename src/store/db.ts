/**
 * IndexedDB: where the log actually lives.
 *
 * For a user who never signs in, this is the *only* copy of their data — not a cache of
 * something a server holds. That single fact drives everything here: schema changes must
 * never discard a record, writes must be durable before the UI claims success, and a
 * browser evicting the origin's storage is data loss rather than a slow reload (#98).
 *
 * The store is deliberately dumb. It holds records keyed by timestamp and knows nothing
 * about people, charts or fields — the fold owns all of that. So a new domain field ships
 * as a client release with no database migration at all, which is the same property that
 * lets the server stay a relay.
 *
 * Snapshots live in their own store and are only ever a cache. If a snapshot is missing,
 * stale or wrong, `resume` rebuilds from the log; nothing here is allowed to treat a
 * snapshot as authoritative.
 *
 * SQLite-WASM was considered and rejected: we already ship 2.5 MB of WebAssembly for the
 * ephemeris, and a few thousand records do not need a query planner.
 */
import type { OpRecord } from './ops.js';
import type { Snapshot } from './fold.js';

export const DB_NAME = 'astraya';

/**
 * The schema version.
 *
 * Only ever incremented, and every step must be additive or transform in place. A
 * migration that drops a store is a migration that deletes the user's only copy, so the
 * upgrade path is tested against a database created by the previous version rather than
 * against a fresh one, which is where migrations look deceptively fine.
 */
export const DB_VERSION = 1;

export const OPS_STORE = 'ops';
export const SNAPSHOT_STORE = 'snapshots';
export const META_STORE = 'meta';

/** The single snapshot key. One materialised view, replaced in place. */
const SNAPSHOT_KEY = 'current';

/**
 * Each migration takes the database from version n-1 to n.
 *
 * Indexed by target version. Kept as data so the list reads as a history, and so a test
 * can walk the versions rather than trusting that a fresh database happens to match.
 */
const MIGRATIONS: readonly ((db: IDBDatabase, transaction: IDBTransaction) => void)[] = [
  // 1: the initial schema.
  (db) => {
    // Keyed by HLC, which is why no explicit key path is needed and why iteration comes
    // back in causal order for free: the encoding sorts lexicographically.
    db.createObjectStore(OPS_STORE, { keyPath: 'hlc' });
    db.createObjectStore(SNAPSHOT_STORE);
    db.createObjectStore(META_STORE);
  },
];

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = (): void => {
      resolve(request.result);
    };
    request.onerror = (): void => {
      reject(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}

/**
 * Wait for a transaction to *complete*, not merely for its requests to succeed.
 *
 * A request succeeding only means IndexedDB accepted it. The transaction is what
 * commits, and it can still abort — over quota, most importantly. Resolving on the
 * request would let the UI report a saved person that never reached the disk.
 */
function committed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = (): void => {
      resolve();
    };
    transaction.onabort = (): void => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    };
    transaction.onerror = (): void => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    };
  });
}

export function openDatabase(name = DB_NAME, version = DB_VERSION): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onupgradeneeded = (event): void => {
      const db = request.result;
      const transaction = request.transaction;
      if (transaction === null) {
        reject(new Error('Upgrade with no transaction'));
        return;
      }
      // `event.oldVersion` is 0 for a fresh database, so a new install runs every
      // migration in order rather than a separate "create schema" path. One code path
      // means the fresh schema cannot drift from the migrated one.
      for (let target = event.oldVersion + 1; target <= version; target += 1) {
        const migration = MIGRATIONS[target - 1];
        if (migration === undefined) {
          reject(new Error(`No migration to database version ${String(target)}`));
          return;
        }
        migration(db, transaction);
      }
    };
    request.onsuccess = (): void => {
      const db = request.result;
      // A newer tab may upgrade the schema underneath this one. Holding the old
      // connection open would block it forever, so close and let the caller reload —
      // continuing to write through a stale schema is the worse option.
      db.onversionchange = (): void => {
        db.close();
      };
      resolve(db);
    };
    request.onerror = (): void => {
      reject(request.error ?? new Error('IndexedDB open failed'));
    };
    request.onblocked = (): void => {
      reject(new Error('Another tab is holding an older version of the database open.'));
    };
  });
}

/**
 * Append records.
 *
 * `put` rather than `add`, so re-receiving a record a peer already sent is not an error.
 * The log has already refused any record whose timestamp collides with a *different*
 * operation, so overwriting here can only ever rewrite an identical value.
 */
export async function putRecords(db: IDBDatabase, records: readonly OpRecord[]): Promise<void> {
  if (records.length === 0) return;
  const transaction = db.transaction(OPS_STORE, 'readwrite');
  const store = transaction.objectStore(OPS_STORE);
  for (const record of records) store.put(record);
  await committed(transaction);
}

/** Every record, ascending by timestamp — which is the key order, so no sort is needed. */
export async function allRecords(db: IDBDatabase): Promise<readonly OpRecord[]> {
  const transaction = db.transaction(OPS_STORE, 'readonly');
  const records = await promisify(transaction.objectStore(OPS_STORE).getAll() as IDBRequest<OpRecord[]>);
  return records;
}

/**
 * Remove specific records by their `hlc` key — the one place a record actually leaves the
 * store rather than being tombstoned. Reserved for an explicit, user-initiated purge; every
 * ordinary delete goes through `putRecords` writing a `deleted` field instead (see fold.ts).
 */
export async function deleteRecords(db: IDBDatabase, hlcs: readonly string[]): Promise<void> {
  if (hlcs.length === 0) return;
  const transaction = db.transaction(OPS_STORE, 'readwrite');
  const store = transaction.objectStore(OPS_STORE);
  for (const hlc of hlcs) store.delete(hlc);
  await committed(transaction);
}

export async function countRecords(db: IDBDatabase): Promise<number> {
  const transaction = db.transaction(OPS_STORE, 'readonly');
  return promisify(transaction.objectStore(OPS_STORE).count());
}

export async function putSnapshot(db: IDBDatabase, snapshot: Snapshot): Promise<void> {
  const transaction = db.transaction(SNAPSHOT_STORE, 'readwrite');
  transaction.objectStore(SNAPSHOT_STORE).put(snapshot, SNAPSHOT_KEY);
  await committed(transaction);
}

export async function getSnapshot(db: IDBDatabase): Promise<Snapshot | undefined> {
  const transaction = db.transaction(SNAPSHOT_STORE, 'readonly');
  const stored = await promisify(transaction.objectStore(SNAPSHOT_STORE).get(SNAPSHOT_KEY) as IDBRequest<unknown>);
  // Validated loosely and on purpose: a snapshot is only a cache, so anything unexpected
  // is discarded in favour of a rebuild rather than repaired.
  if (typeof stored !== 'object' || stored === null) return undefined;
  const candidate = stored as Partial<Snapshot>;
  if (typeof candidate.registers !== 'object') return undefined;
  if (typeof candidate.applied !== 'number') return undefined;
  return candidate as Snapshot;
}

export async function getMeta(db: IDBDatabase, key: string): Promise<unknown> {
  const transaction = db.transaction(META_STORE, 'readonly');
  return promisify(transaction.objectStore(META_STORE).get(key) as IDBRequest<unknown>);
}

export async function putMeta(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  const transaction = db.transaction(META_STORE, 'readwrite');
  transaction.objectStore(META_STORE).put(value, key);
  await committed(transaction);
}

/** This device's id, generated once and then stable — the identity in every timestamp. */
export const DEVICE_ID_KEY = 'deviceId';
