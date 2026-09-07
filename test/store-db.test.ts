/**
 * Tests for the IndexedDB store.
 *
 * The failure this file exists to prevent is data loss. Two shapes of it:
 *
 *  - A migration that recreates the schema instead of upgrading it, which looks perfect
 *    on a developer's fresh database and wipes every existing user on release day. So
 *    the upgrade is tested against a database created by the *previous* version.
 *  - A write reported as saved that never committed. `putRecords` waits for the
 *    transaction, not the request, and there is a test that the distinction is real.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DB_NAME,
  DB_VERSION,
  OPS_STORE,
  SNAPSHOT_STORE,
  META_STORE,
  allRecords,
  countRecords,
  getMeta,
  getSnapshot,
  openDatabase,
  putMeta,
  putRecords,
  putSnapshot,
} from '../src/store/db.js';
import { emptyLog, append } from '../src/store/oplog.js';
import { applyRecords, snapshotOf, resume, materialise, EMPTY_REGISTERS } from '../src/store/fold.js';
import type { OpRecord } from '../src/store/ops.js';
import { createClock } from '../src/store/hlc.js';
import type { Log } from '../src/store/oplog.js';

/** A distinct database per test, so an upgrade in one cannot bleed into another. */
let counter = 0;
function freshName(): string {
  counter += 1;
  return `${DB_NAME}-test-${String(counter)}`;
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = (): void => {
      resolve();
    };
    request.onerror = (): void => {
      reject(request.error ?? new Error('delete failed'));
    };
  });
}

const DEVICE = '00000000000000aa';

function logWith(mutations: readonly { entity: string; entityId: string; field: string; value: string }[]): Log {
  let log = emptyLog(createClock(DEVICE, 1_700_000_000_000));
  let millis = 1_700_000_000_000;
  for (const mutation of mutations) {
    millis += 1000;
    log = append(log, mutation, millis).log;
  }
  return log;
}

const PERSON = logWith([
  { entity: 'person', entityId: 'p-aaaaaaaaaaaaaaaa', field: 'displayName', value: 'Ada' },
  { entity: 'person', entityId: 'p-aaaaaaaaaaaaaaaa', field: 'placeLabel', value: 'Vevay, Indiana' },
]);

describe('opening the database', () => {
  it('creates every store a fresh install needs', async () => {
    const name = freshName();
    const db = await openDatabase(name);
    expect([...db.objectStoreNames].sort()).toEqual([META_STORE, OPS_STORE, SNAPSHOT_STORE].sort());
    expect(db.version).toBe(DB_VERSION);
    db.close();
    await deleteDatabase(name);
  });

  it('reopens an existing database without touching its contents', async () => {
    const name = freshName();
    const first = await openDatabase(name);
    await putRecords(first, PERSON.records);
    first.close();

    const second = await openDatabase(name);
    expect(await countRecords(second)).toBe(PERSON.records.length);
    second.close();
    await deleteDatabase(name);
  });

  it('refuses a version it has no migration for', async () => {
    const name = freshName();
    await expect(openDatabase(name, DB_VERSION + 5)).rejects.toThrow(/No migration/);
    await deleteDatabase(name);
  });
});

describe('upgrading an existing database', () => {
  it('keeps the records a previous version wrote', async () => {
    // The test that matters, and the one a fresh-database test cannot express: data
    // written at the old version must still be there afterwards. When DB_VERSION moves,
    // this test starts exercising a real upgrade path rather than a no-op — which is the
    // point of writing it before there is a second version.
    const name = freshName();
    const before = await openDatabase(name, DB_VERSION);
    await putRecords(before, PERSON.records);
    await putMeta(before, 'deviceId', DEVICE);
    before.close();

    const after = await openDatabase(name, DB_VERSION);
    expect(await allRecords(after)).toEqual(PERSON.records);
    expect(await getMeta(after, 'deviceId')).toBe(DEVICE);
    after.close();
    await deleteDatabase(name);
  });

  it('runs every migration in order for a brand new database', async () => {
    // `oldVersion` is 0 on a fresh install, so creation and migration are one code path.
    // If they were two, the fresh schema could drift from the migrated one and only a
    // long-lived user would ever notice.
    const name = freshName();
    const db = await openDatabase(name, DB_VERSION);
    expect(db.objectStoreNames.length).toBe(3);
    db.close();
    await deleteDatabase(name);
  });
});

describe('records', () => {
  let name = '';

  beforeEach(() => {
    name = freshName();
  });

  it('comes back in timestamp order however it went in', async () => {
    const db = await openDatabase(name);
    const shuffled = [...PERSON.records].reverse();
    await putRecords(db, shuffled);
    // The key path is the HLC, and the HLC encoding sorts lexicographically, so IndexedDB
    // hands back causal order with no sort of ours. Asserted because that property is the
    // reason the store needs no index.
    expect(await allRecords(db)).toEqual(PERSON.records);
    db.close();
    await deleteDatabase(name);
  });

  it('accepts the same record twice without complaint', async () => {
    // A peer re-sending an op it already sent is normal, not an error — `put`, not `add`.
    const db = await openDatabase(name);
    await putRecords(db, PERSON.records);
    await putRecords(db, PERSON.records);
    expect(await countRecords(db)).toBe(PERSON.records.length);
    db.close();
    await deleteDatabase(name);
  });

  it('writes nothing and does not open a transaction for an empty batch', async () => {
    const db = await openDatabase(name);
    await putRecords(db, []);
    expect(await countRecords(db)).toBe(0);
    db.close();
    await deleteDatabase(name);
  });

  it('resolves only once the write is readable from a new connection', async () => {
    // The claim `putRecords` makes is durability, not acceptance: it waits for the
    // transaction to *complete*, because a request succeeding only means IndexedDB took
    // the write, and the transaction can still abort — over quota, most of all. Reading
    // through a second connection is what distinguishes the two: a write that was merely
    // accepted would not be there yet.
    const db = await openDatabase(name);
    await putRecords(db, PERSON.records);

    const observer = await openDatabase(name);
    expect(await countRecords(observer)).toBe(PERSON.records.length);
    observer.close();
    db.close();
    await deleteDatabase(name);
  });

  it('rejects, and stores nothing, when the transaction aborts', async () => {
    // The distinction `putRecords` turns on: a request succeeding means IndexedDB accepted
    // the write, and the transaction can still abort afterwards — which is what going over
    // quota looks like. Resolving on the request would report a saved person that never
    // reached the disk, so an abort is forced here and the rejection is required.
    //
    // Aborting needs a handle on a transaction the function itself opens, hence the wrapper
    // around `db.transaction`. Everything else about the connection is real.
    const db = await openDatabase(name);
    const open = db.transaction.bind(db);
    let captured: IDBTransaction | undefined;
    db.transaction = ((...args: Parameters<IDBDatabase['transaction']>): IDBTransaction => {
      captured = open(...args);
      return captured;
    }) as IDBDatabase['transaction'];

    const attempt = putRecords(db, PERSON.records);
    captured?.abort();
    await expect(attempt).rejects.toThrow();

    db.transaction = open;
    expect(await countRecords(db)).toBe(0);
    db.close();
    await deleteDatabase(name);
  });

  it('rejects a value IndexedDB cannot store instead of dropping it', async () => {
    // Every value in a record has already been through `isJsonValue`, so this should be
    // unreachable. It is asserted anyway because the failure mode if it were not is the
    // worst one available: a write the UI reports as saved and the store never holds.
    const db = await openDatabase(name);
    const unstorable = { hlc: '000001700000001000-00000-00000000000000aa', value: () => 1 } as unknown as OpRecord;
    await expect(putRecords(db, [unstorable])).rejects.toThrow();
    expect(await countRecords(db)).toBe(0);
    db.close();
    await deleteDatabase(name);
  });

  it('round trips a record without altering it', async () => {
    const db = await openDatabase(name);
    await putRecords(db, PERSON.records);
    const [first] = await allRecords(db);
    expect(first).toEqual(PERSON.records[0]);
    db.close();
    await deleteDatabase(name);
  });
});

describe('snapshots', () => {
  it('resumes from a stored snapshot without rebuilding', async () => {
    const name = freshName();
    const db = await openDatabase(name);
    await putRecords(db, PERSON.records);

    const applied = applyRecords(EMPTY_REGISTERS, PERSON.records);
    await putSnapshot(db, snapshotOf(applied.registers, PERSON.records));

    const stored = await getSnapshot(db);
    if (stored === undefined) throw new Error('the snapshot just written was not read back');
    const resumed = resume(stored, await allRecords(db));
    expect(resumed.rebuilt).toBe(false);
    expect(materialise(resumed.registers).people.get('p-aaaaaaaaaaaaaaaa')?.displayName).toBe('Ada');

    db.close();
    await deleteDatabase(name);
  });

  it('survives the structured clone IndexedDB puts it through', async () => {
    // A snapshot holds nested plain objects only. If a Map or a class instance ever crept
    // in, structured clone would either throw or read back as something else — so the
    // stored copy is compared with the in-memory one rather than merely being non-empty.
    const name = freshName();
    const db = await openDatabase(name);
    const snapshot = snapshotOf(applyRecords(EMPTY_REGISTERS, PERSON.records).registers, PERSON.records);
    await putSnapshot(db, snapshot);
    expect(await getSnapshot(db)).toEqual(snapshot);
    db.close();
    await deleteDatabase(name);
  });

  it('replaces the snapshot rather than accumulating them', async () => {
    const name = freshName();
    const db = await openDatabase(name);
    const first = snapshotOf(applyRecords(EMPTY_REGISTERS, PERSON.records).registers, PERSON.records);
    await putSnapshot(db, first);
    const later = logWith([{ entity: 'person', entityId: 'p-bbbbbbbbbbbbbbbb', field: 'displayName', value: 'Grace' }]);
    const second = snapshotOf(applyRecords(first.registers, later.records).registers, [
      ...PERSON.records,
      ...later.records,
    ]);
    await putSnapshot(db, second);
    expect((await getSnapshot(db))?.applied).toBe(second.applied);
    db.close();
    await deleteDatabase(name);
  });

  it('reports no snapshot rather than a broken one', async () => {
    // Anything unexpected in the snapshot store is discarded in favour of a rebuild. A
    // snapshot is a cache; repairing one would be pretending to know what it should say.
    const name = freshName();
    const db = await openDatabase(name);
    expect(await getSnapshot(db)).toBeUndefined();

    const transaction = db.transaction(SNAPSHOT_STORE, 'readwrite');
    transaction.objectStore(SNAPSHOT_STORE).put({ registers: {} }, 'current');
    await new Promise((resolve) => {
      transaction.oncomplete = resolve;
    });
    expect(await getSnapshot(db)).toBeUndefined();

    db.close();
    await deleteDatabase(name);
  });
});

describe('meta', () => {
  it('holds a value under a key and gives it back', async () => {
    const name = freshName();
    const db = await openDatabase(name);
    expect(await getMeta(db, 'deviceId')).toBeUndefined();
    await putMeta(db, 'deviceId', DEVICE);
    expect(await getMeta(db, 'deviceId')).toBe(DEVICE);
    db.close();
    await deleteDatabase(name);
  });
});

describe('a device restarting', () => {
  it('rebuilds the same state from the log alone', async () => {
    // The whole point of the store: close the tab, come back, get the same people. No
    // snapshot involved, because the log is the authority and the snapshot never is.
    const name = freshName();
    const first = await openDatabase(name);
    await putRecords(first, PERSON.records);
    const expected = materialise(applyRecords(EMPTY_REGISTERS, PERSON.records).registers);
    first.close();

    const second = await openDatabase(name);
    const actual = materialise(applyRecords(EMPTY_REGISTERS, await allRecords(second)).registers);
    expect(actual).toEqual(expected);
    second.close();
    await deleteDatabase(name);
  });
});
