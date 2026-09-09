/**
 * The live store: the one object the UI talks to.
 *
 * Everything underneath this file is pure — the log is a value, the fold is a function,
 * the clock is a value with a `tick`. That is deliberate, and this module is where the
 * impurity is concentrated instead of being spread through the UI: opening the database,
 * generating a device id once, writing records, and telling React that something changed.
 *
 * Three rules it exists to enforce:
 *
 *  1. **The log is the authority.** State is always a fold of records, never edited in
 *     place. A screen showing a person that no record produced is a bug with nowhere to
 *     hide, because there is only one way state is ever computed.
 *  2. **Mutations are serialised.** `Log` is an immutable value threaded through `append`,
 *     so two overlapping mutations that both start from the same log would produce two
 *     next-logs and one of them would be lost. The queue below is what makes that
 *     impossible rather than unlikely.
 *  3. **A record reaches the database before the UI is told it happened.** The alternative
 *     is an interface that reports a saved person the store does not have.
 */
import {
  DEVICE_ID_KEY,
  allRecords,
  deleteRecords,
  getMeta,
  getSnapshot,
  openDatabase,
  putMeta,
  putRecords,
  putSnapshot,
} from './db.js';
import { EMPTY_REGISTERS, DELETED_FIELD, applyRecords, materialise, resume, snapshotOf } from './fold.js';
import { append, emptyLog, latest, purgeEntity, since } from './oplog.js';
import { createClock, isNodeId, randomNodeId, receive } from './hlc.js';
import { requestPersistence } from './persist.js';
import type { Registers, State } from './fold.js';
import type { Log, Mutation } from './oplog.js';
import type { Hlc, NodeId } from './hlc.js';
import type { OpRecord } from './ops.js';
import type { Persistence } from './persist.js';

/**
 * How many records may accumulate before the snapshot is rewritten.
 *
 * A snapshot costs O(state) to write and saves O(log) at startup, so rewriting on every
 * mutation would make every keystroke pay for a faster launch nobody asked for. 50 is a
 * guess, and safe to get wrong in either direction: the snapshot is only a cache, and
 * `resume` rebuilds whenever it cannot be trusted.
 */
const SNAPSHOT_EVERY = 50;

export interface Store {
  /** The current fold. Replaced wholesale on every change, never mutated. */
  readonly state: State;
  /** Whether the browser has promised to keep this data (#98). */
  readonly persistence: Persistence;
  /** This device's identity, present in every timestamp it writes. */
  readonly deviceId: NodeId;
  /**
   * Whether the stored snapshot was usable at startup.
   *
   * False means the log was folded from the beginning — normal on a first run, and after a
   * peer's record arrived behind the snapshot's watermark. Surfaced rather than kept private
   * because it is the difference between a fast launch and a slow one, and #101 has a place
   * to say so.
   */
  readonly resumedFromSnapshot: boolean;
  /** Write fields. Resolves once the records are durable and `state` has been replaced. */
  mutate(mutations: readonly Mutation[]): Promise<void>;
  /** Mark an entity deleted. A tombstone is a field write, so undo is one more write. */
  remove(entity: string, entityId: string): Promise<void>;
  /** Undo a delete. Possible precisely because the tombstone was never a real deletion. */
  restore(entity: string, entityId: string): Promise<void>;
  /**
   * Permanently erase every record naming this entity. Unlike `remove`, there is no undo —
   * this is the only way a person's data actually leaves the device rather than being
   * hidden. Local only: with no sync engine yet (M8), it cannot reach a copy already on
   * another device, and a purge that must do that is a problem for that engine's own
   * design, not this one's.
   */
  purge(entity: string, entityId: string): Promise<void>;
  /** Records a peer has not seen, for the sync engine in M8. */
  outgoing(cursor?: Hlc): readonly OpRecord[];
  /** Newest timestamp in the log, or undefined when it is empty. */
  head(): Hlc | undefined;
  subscribe(listener: () => void): () => void;
  close(): void;
}

export interface StoreOptions {
  /** Database name. Overridden by tests so they do not share one database. */
  readonly name?: string;
  /** The clock, injected so tests are not at the mercy of the wall clock. */
  readonly now?: () => number;
}

/**
 * This device's id, generated once and then never again.
 *
 * It is the identity inside every timestamp this device writes, so regenerating it would
 * make the device look like a new one to every peer and, worse, break the tie-break that
 * keeps two simultaneous writes ordered. Hence: stored, validated on read, and only
 * replaced if what came back is not a device id at all.
 */
async function deviceIdFor(db: IDBDatabase): Promise<NodeId> {
  const stored = await getMeta(db, DEVICE_ID_KEY);
  if (isNodeId(stored)) return stored;
  const generated = randomNodeId();
  await putMeta(db, DEVICE_ID_KEY, generated);
  return generated;
}

export async function openStore(options: StoreOptions = {}): Promise<Store> {
  const now = options.now ?? ((): number => Date.now());
  const db = await openDatabase(options.name);
  const deviceId = await deviceIdFor(db);
  const records = await allRecords(db);

  // Restore from the snapshot when it is trustworthy, and rebuild when it is not. `resume`
  // decides, because the test is subtler than a timestamp comparison: a record from a peer
  // can arrive after the snapshot was written and still be older than its watermark, and
  // filtering by timestamp would skip such a record forever.
  //
  // Deleting these two lines and always folding from scratch passes every test in this
  // file, and that is correct rather than a gap: the snapshot changes only how long startup
  // takes. Its equivalence to a full rebuild is asserted where it belongs, in the fold's own
  // tests, which compare `resume` against rebuilding record for record.
  const stored = await getSnapshot(db);
  const resumed = stored === undefined ? undefined : resume(stored, records);
  const applied = resumed ?? applyRecords(EMPTY_REGISTERS, records);
  const resumedFromSnapshot = resumed !== undefined && !resumed.rebuilt;

  let log: Log = emptyLog(createClock(deviceId, now()));
  let registers: Registers = applied.registers;
  let state: State = materialise(registers);
  let sinceSnapshot = stored === undefined ? records.length : records.length - stored.applied;
  const listeners = new Set<() => void>();

  // Adopt the stored records as the in-memory log. They are not re-appended: `append`
  // would restamp them, and they already carry the timestamps their writers gave them.
  //
  // The clock, however, has to be dragged past the newest record before the first local
  // write. A device that was ahead of this one, or a clock that has since gone backwards,
  // would otherwise get the next edit stamped underneath history — and LWW would then
  // discard the edit the user just made in favour of the value they were changing.
  log = { clock: log.clock, records };
  const newest = latest(log);
  if (newest !== undefined) log = { clock: receive(log.clock, newest, now()).clock, records };

  const persistence = await requestPersistence();

  /**
   * Mutations run one at a time.
   *
   * Not for database reasons — IndexedDB serialises its own transactions — but because
   * `log` is an immutable value read at the start of a mutation and written at the end.
   * Two overlapping mutations would both read the same log and the second would overwrite
   * the first's record. Chaining onto a tail promise is the whole mechanism.
   */
  let tail: Promise<void> = Promise.resolve();
  function serialise(work: () => Promise<void>): Promise<void> {
    // `catch` on the tail, not on the returned promise: a failed mutation must not poison
    // the queue for every later one, but its caller still has to see the failure.
    const run = tail.then(work);
    tail = run.catch(() => undefined);
    return run;
  }

  function write(mutations: readonly Mutation[]): Promise<void> {
    return serialise(async () => {
      if (mutations.length === 0) return;
      let next = log;
      const written: OpRecord[] = [];
      for (const mutation of mutations) {
        const result = append(next, mutation, now());
        next = result.log;
        written.push(result.record);
      }

      // Durable first. If this throws — over quota, most likely — the in-memory log is
      // untouched and the UI has not been told anything happened, which is the honest
      // outcome: the user's edit did not take, and they can be told so.
      await putRecords(db, written);

      log = next;
      registers = applyRecords(registers, written).registers;
      state = materialise(registers);
      sinceSnapshot += written.length;

      if (sinceSnapshot >= SNAPSHOT_EVERY) {
        // Best effort on purpose. A snapshot that failed to write costs a slower next
        // launch; failing the user's edit over it would cost them the edit.
        try {
          await putSnapshot(db, snapshotOf(registers, log.records));
          sinceSnapshot = 0;
        } catch {
          /* rebuilt from the log next time instead */
        }
      }

      for (const listener of listeners) listener();
    });
  }

  return {
    get state() {
      return state;
    },
    get persistence() {
      return persistence;
    },
    deviceId,
    resumedFromSnapshot,
    mutate: write,
    remove: (entity, entityId) => write([{ entity, entityId, field: DELETED_FIELD, value: true }]),
    restore: (entity, entityId) => write([{ entity, entityId, field: DELETED_FIELD, value: false }]),
    purge: (entity, entityId) =>
      serialise(async () => {
        const { log: purgedLog, removed } = purgeEntity(log, entity, entityId);
        if (removed.length === 0) return;

        // Durable removal first, matching `write`'s own rule: the UI must not be told an
        // erase happened until the rows are actually gone from disk.
        await deleteRecords(
          db,
          removed.map((record) => String(record.hlc)),
        );

        log = purgedLog;
        // Rebuilt from scratch rather than patched: registers have no notion of "unwrite
        // this field", only "here is its latest value", so removing a record's effect
        // means refolding what is left. Purging is a rare, explicit action, not a hot
        // path, so the O(records) cost is not one worth avoiding.
        registers = applyRecords(EMPTY_REGISTERS, log.records).registers;
        state = materialise(registers);

        // Best effort, like the snapshot write in `write` below: a stale snapshot left on
        // disk is still safe, because `resume` rebuilds whenever the log holds a different
        // number of records at-or-below the snapshot's watermark than the snapshot recorded
        // — which purging guarantees here.
        try {
          await putSnapshot(db, snapshotOf(registers, log.records));
          sinceSnapshot = 0;
        } catch {
          /* rebuilt from the log next time instead */
        }

        for (const listener of listeners) listener();
      }),
    outgoing: (cursor) => since(log, cursor),
    head: () => latest(log),
    subscribe(listener) {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    close() {
      listeners.clear();
      db.close();
    },
  };
}
