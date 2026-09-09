/**
 * Tests for the append-only log.
 *
 * The property that matters is convergence: two devices editing offline, then learning
 * of each other in whatever order the network allows, must end up holding the same
 * sequence. So most of these tests are about *arrival order* — shuffling, replaying,
 * and syncing in both directions — rather than about a single call's return value.
 */
import { describe, expect, it } from 'vitest';
import { createClock, decodeHlc, DRIFT_REPORT_THRESHOLD_MS } from '../src/store/hlc.js';
import {
  append,
  emptyLog,
  latest,
  purgeEntity,
  receiveRecords,
  since,
  type Log,
  type Mutation,
} from '../src/store/oplog.js';
import type { OpRecord } from '../src/store/ops.js';

const A = 'a1b2c3d4e5f60718';
const B = 'b0000000000000ff';
const T0 = 1_780_963_200_000;

function logFor(nodeId: string): Log {
  return emptyLog(createClock(nodeId));
}

/** Append several mutations at one instant, which is what a form submission looks like. */
function appendAll(log: Log, mutations: readonly Mutation[], millis = T0): Log {
  return mutations.reduce((current, mutation) => append(current, mutation, millis).log, log);
}

function set(entityId: string, field: string, value: string | number): Mutation {
  return { entity: 'person', entityId, field, value };
}

function stamps(log: Log): string[] {
  return log.records.map((record) => String(record.hlc));
}

describe('appending', () => {
  it('stamps a mutation and stores it', () => {
    const { log, record } = append(logFor(A), set('p-1', 'name', 'Ada'), T0);
    expect(record.entity).toBe('person');
    expect(decodeHlc(String(record.hlc)).nodeId).toBe(A);
    expect(log.records).toEqual([record]);
  });

  it('keeps records ordered even when the device clock goes backwards', () => {
    // A clock that jumps back is not hypothetical — NTP corrections and suspended
    // laptops both do it. The log must not reorder because of it.
    let log = logFor(A);
    log = append(log, set('p-1', 'a', 1), T0).log;
    log = append(log, set('p-1', 'b', 2), T0 - 60_000).log;
    log = append(log, set('p-1', 'c', 3), T0 + 1).log;
    expect(stamps(log)).toEqual([...stamps(log)].sort());
    expect(log.records.map((record) => record.field)).toEqual(['a', 'b', 'c']);
  });

  it('gives every record a distinct timestamp within one millisecond', () => {
    const log = appendAll(logFor(A), [set('p-1', 'a', 1), set('p-1', 'b', 2), set('p-1', 'c', 3)]);
    expect(new Set(stamps(log)).size).toBe(3);
  });

  it('refuses a value that could not be read back', () => {
    expect(() => append(logFor(A), set('p-1', 'latitude', Number.NaN), T0)).toThrow(/Refusing to write/);
  });
});

describe('receiving from a peer', () => {
  it('merges records into timestamp order, not arrival order', () => {
    const theirs = appendAll(logFor(B), [set('p-2', 'a', 1), set('p-2', 'b', 2)], T0 - 5_000);
    const mine = appendAll(logFor(A), [set('p-1', 'a', 1)], T0);
    const merged = receiveRecords(mine, [...theirs.records].reverse(), T0);
    expect(stamps(merged.log)).toEqual([...stamps(merged.log)].sort());
    expect(merged.added).toHaveLength(2);
    expect(merged.log.records).toHaveLength(3);
  });

  it('treats a re-sent record as a duplicate rather than an error', () => {
    // Sync protocols re-send. If this were not idempotent, every retry would corrupt
    // the log or fail the sync.
    const theirs = appendAll(logFor(B), [set('p-2', 'a', 1)], T0);
    const once = receiveRecords(logFor(A), theirs.records, T0);
    const twice = receiveRecords(once.log, theirs.records, T0);
    expect(twice.duplicates).toBe(1);
    expect(twice.added).toHaveLength(0);
    expect(twice.log.records).toHaveLength(1);
  });

  it('ignores key order when deciding whether a record is a duplicate', () => {
    const theirs = appendAll(logFor(B), [set('p-2', 'a', 1)], T0);
    const [original] = theirs.records;
    if (original === undefined) throw new Error('fixture');
    const reordered = Object.fromEntries(Object.entries(original).reverse()) as OpRecord;
    const merged = receiveRecords(receiveRecords(logFor(A), [original], T0).log, [reordered], T0);
    expect(merged.duplicates).toBe(1);
    expect(merged.rejected).toEqual([]);
  });

  it('refuses two different operations claiming one timestamp', () => {
    // Impossible for a device following the rules, so it means a reused clock or an
    // altered record. Keeping one silently would destroy an edit nobody could account
    // for afterwards.
    const theirs = appendAll(logFor(B), [set('p-2', 'a', 1)], T0);
    const [original] = theirs.records;
    if (original === undefined) throw new Error('fixture');
    const forged = { ...original, value: 999 };
    const merged = receiveRecords(receiveRecords(logFor(A), [original], T0).log, [forged], T0);
    expect(merged.added).toHaveLength(0);
    expect(merged.duplicates).toBe(0);
    expect(merged.rejected[0]?.reason).toMatch(/already held by a different operation/);
    expect(merged.log.records[0]?.value).toBe(1);
  });

  it('stores an operation from a newer client without interpreting it', () => {
    // This device may be the only route by which that operation reaches a third. It
    // goes into the log unread; the fold is what skips it.
    const theirs = appendAll(logFor(B), [set('p-2', 'a', 1)], T0);
    const [original] = theirs.records;
    if (original === undefined) throw new Error('fixture');
    const future = { ...original, opVersion: 99, somethingNew: true };
    const merged = receiveRecords(logFor(A), [future], T0);
    expect(merged.added).toEqual([future]);
    expect(merged.log.records).toEqual([future]);
  });

  it('advances the clock past a record it cannot interpret', () => {
    // Otherwise the next local edit would be stamped as though the unreadable one had
    // never happened, losing the ordering between them.
    const theirs = appendAll(logFor(B), [set('p-2', 'a', 1)], T0 + 10_000);
    const [original] = theirs.records;
    if (original === undefined) throw new Error('fixture');
    const merged = receiveRecords(logFor(A), [{ ...original, opVersion: 99 }], T0);
    const next = append(merged.log, set('p-1', 'b', 2), T0);
    expect(stamps(next.log)).toEqual([...stamps(next.log)].sort());
    expect(decodeHlc(String(next.record.hlc)).millis).toBeGreaterThanOrEqual(T0 + 10_000);
  });

  it('quarantines a corrupt record instead of failing the whole batch', () => {
    const theirs = appendAll(logFor(B), [set('p-2', 'a', 1), set('p-2', 'b', 2)], T0);
    const merged = receiveRecords(logFor(A), [theirs.records[0], { opVersion: 1, hlc: 'nope' }, theirs.records[1]], T0);
    expect(merged.added).toHaveLength(2);
    expect(merged.rejected).toHaveLength(1);
    expect(merged.rejected[0]?.reason).toMatch(/hlc is not a timestamp/);
  });

  it('reports a peer whose clock is far ahead, while still accepting the record', () => {
    // Rejecting would break convergence; only the server is placed to rule on a clock
    // that is genuinely wrong (#105). Saying so is this layer's whole job.
    const ahead = appendAll(logFor(B), [set('p-2', 'a', 1)], T0 + DRIFT_REPORT_THRESHOLD_MS * 2);
    const merged = receiveRecords(logFor(A), ahead.records, T0);
    expect(merged.drift).toHaveLength(1);
    expect(merged.added).toHaveLength(1);
  });
});

describe('two devices converging', () => {
  const mineFirst = (): Log => appendAll(logFor(A), [set('p-1', 'name', 'Ada'), set('p-1', 'city', 'Vevay')], T0);
  const theirsFirst = (): Log =>
    appendAll(logFor(B), [set('p-1', 'name', 'Grace'), set('p-2', 'name', 'Ida')], T0 + 500);

  it('reaches one sequence whichever direction syncs first', () => {
    const aThenB = receiveRecords(mineFirst(), theirsFirst().records, T0 + 1_000);
    const bThenA = receiveRecords(theirsFirst(), mineFirst().records, T0 + 1_000);
    expect(stamps(aThenB.log)).toEqual(stamps(bThenA.log));
    expect(stamps(aThenB.log)).toHaveLength(4);
  });

  it('reaches the same sequence for any arrival order of the same records', () => {
    // Stands in for a property test: a fixed set of records, shuffled deterministically,
    // must always land in the same sequence. Sorted-by-timestamp is the merge, so this
    // is the assertion the fold's determinism rests on.
    const all = [...mineFirst().records, ...theirsFirst().records];
    const orders = [all, [...all].reverse(), [all[2], all[0], all[3], all[1]], [all[1], all[3], all[0], all[2]]];
    const results = orders.map((order) => stamps(receiveRecords(logFor('c000000000000001'), order, T0).log));
    for (const result of results) expect(result).toEqual(results[0]);
    expect(results[0]).toHaveLength(4);
  });

  it('converges after a round trip in both directions', () => {
    const a = mineFirst();
    const b = theirsFirst();
    const aSynced = receiveRecords(a, since(b), T0 + 2_000);
    const bSynced = receiveRecords(b, since(a), T0 + 2_000);
    expect(stamps(aSynced.log)).toEqual(stamps(bSynced.log));
    // And a second round trip changes nothing, which is what makes sync safe to repeat.
    const again = receiveRecords(aSynced.log, since(bSynced.log), T0 + 3_000);
    expect(again.added).toHaveLength(0);
    expect(stamps(again.log)).toEqual(stamps(aSynced.log));
  });
});

describe('the sync cursor', () => {
  it('sends everything when the peer has nothing', () => {
    const log = appendAll(logFor(A), [set('p-1', 'a', 1), set('p-1', 'b', 2)]);
    expect(since(log)).toEqual(log.records);
  });

  it('excludes the cursor record itself, so nothing is sent twice', () => {
    const log = appendAll(logFor(A), [set('p-1', 'a', 1), set('p-1', 'b', 2), set('p-1', 'c', 3)]);
    const [, second] = log.records;
    expect(since(log, String(second?.hlc)).map((record) => record.field)).toEqual(['c']);
    expect(since(log, latest(log))).toEqual([]);
  });

  it('sends records older than a cursor it has never seen', () => {
    // A peer's cursor may name a record this device does not hold — it synced with a
    // third device. Everything at or after that point must still be sent.
    const log = appendAll(logFor(A), [set('p-1', 'a', 1), set('p-1', 'b', 2)]);
    // Same millisecond and counter as the first record, but a higher device id, so it
    // sorts between the two records this device holds.
    const unknown = `000001780963200000-00000-${B}`;
    expect(since(log, unknown).map((record) => record.field)).toEqual(['b']);
  });

  it('has no cursor for an empty log', () => {
    expect(latest(logFor(A))).toBeUndefined();
    expect(since(logFor(A))).toEqual([]);
  });
});

describe('purging an entity', () => {
  it('removes every record naming that entity and reports them', () => {
    const log = appendAll(logFor(A), [set('p-1', 'a', 1), set('p-2', 'a', 1), set('p-1', 'b', 2)]);
    const { log: purged, removed } = purgeEntity(log, 'person', 'p-1');
    expect(purged.records.map((record) => record.entityId)).toEqual(['p-2']);
    expect(removed).toHaveLength(2);
    expect(removed.every((record) => record.entityId === 'p-1')).toBe(true);
  });

  it('leaves the log untouched, and reports nothing removed, for an id it never held', () => {
    const log = appendAll(logFor(A), [set('p-1', 'a', 1)]);
    const { log: purged, removed } = purgeEntity(log, 'person', 'p-2');
    expect(purged.records).toEqual(log.records);
    expect(removed).toEqual([]);
  });

  it('does not match a record it cannot read the body of', () => {
    // A future-versioned record's entity/entityId are uninterpretable at this build, so a
    // purge must keep it rather than guess — the same rule `decode` applies everywhere.
    const log = appendAll(logFor(A), [set('p-1', 'a', 1)]);
    const [original] = log.records;
    if (original === undefined) throw new Error('fixture');
    const future = { ...original, opVersion: 99, somethingNew: true };
    const withFuture: Log = { clock: log.clock, records: [future] };
    const { log: purged, removed } = purgeEntity(withFuture, 'person', 'p-1');
    expect(purged.records).toEqual([future]);
    expect(removed).toEqual([]);
  });

  it('only matches the named entity kind, not any id collision across kinds', () => {
    const log = appendAll(logFor(A), [set('p-1', 'a', 1)]);
    const { log: purged, removed } = purgeEntity(log, 'chart', 'p-1');
    expect(purged.records).toEqual(log.records);
    expect(removed).toEqual([]);
  });
});
