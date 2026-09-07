/**
 * Tests for the live store.
 *
 * The store is where the pure pieces meet a real database, so the tests here are about
 * the joins rather than the parts: that a mutation is durable before the UI hears about
 * it, that overlapping mutations cannot lose one another, that a reopened store is the
 * same store, and that a device id is generated once and then kept forever.
 */
import { describe, expect, it } from 'vitest';
import { openStore } from '../src/store/store.js';
import { openDatabase, allRecords, getSnapshot, DEVICE_ID_KEY, putMeta } from '../src/store/db.js';
import { isNodeId } from '../src/store/hlc.js';
import type { Store } from '../src/store/store.js';

let counter = 0;
function freshName(): string {
  counter += 1;
  return `astraya-store-test-${String(counter)}`;
}

/** A clock the tests control, so ordering is a fact rather than a race. */
function ticking(start = 1_700_000_000_000): () => number {
  let millis = start;
  return () => {
    millis += 1000;
    return millis;
  };
}

const PERSON = 'p-aaaaaaaaaaaaaaaa';
const OTHER = 'p-bbbbbbbbbbbbbbbb';
const CHART = 'c-cccccccccccccccc';

function named(entityId: string, value: string): { entity: string; entityId: string; field: string; value: string } {
  return { entity: 'person', entityId, field: 'displayName', value };
}

async function withStore(body: (store: Store, name: string) => Promise<void>): Promise<void> {
  const name = freshName();
  const store = await openStore({ name, now: ticking() });
  try {
    await body(store, name);
  } finally {
    store.close();
  }
}

describe('opening a store', () => {
  it('starts empty', async () => {
    await withStore(async (store) => {
      expect(store.state.people.size).toBe(0);
      expect(store.head()).toBeUndefined();
      await Promise.resolve();
    });
  });

  it('generates a device id once and keeps it', async () => {
    // The device id is the identity inside every timestamp this device writes. A new one
    // on each launch would make one device look like many to its peers and break the
    // tie-break that keeps simultaneous writes ordered.
    const name = freshName();
    const first = await openStore({ name });
    const id = first.deviceId;
    expect(isNodeId(id)).toBe(true);
    first.close();

    const second = await openStore({ name });
    expect(second.deviceId).toBe(id);
    second.close();
  });

  it('replaces a stored device id that is not one', async () => {
    const name = freshName();
    const db = await openDatabase(name);
    await putMeta(db, DEVICE_ID_KEY, 'not-a-device-id');
    db.close();

    const store = await openStore({ name });
    expect(isNodeId(store.deviceId)).toBe(true);
    expect(store.deviceId).not.toBe('not-a-device-id');
    store.close();
  });
});

describe('writing', () => {
  it('puts the record in the database before reporting success', async () => {
    // If this order were reversed the UI could show a saved person the store does not
    // have — the single most misleading thing a local-first app can do.
    await withStore(async (store, name) => {
      await store.mutate([named(PERSON, 'Ada')]);
      const observer = await openDatabase(name);
      expect((await allRecords(observer)).length).toBe(1);
      observer.close();
    });
  });

  it('materialises what was written', async () => {
    await withStore(async (store) => {
      await store.mutate([
        named(PERSON, 'Ada'),
        { entity: 'person', entityId: PERSON, field: 'placeLabel', value: 'Vevay, Indiana' },
      ]);
      expect(store.state.people.get(PERSON)?.displayName).toBe('Ada');
      expect(store.state.people.get(PERSON)?.placeLabel).toBe('Vevay, Indiana');
    });
  });

  it('notifies subscribers once per mutation, not once per field', async () => {
    await withStore(async (store) => {
      let calls = 0;
      const unsubscribe = store.subscribe(() => {
        calls += 1;
      });
      await store.mutate([named(PERSON, 'Ada'), named(OTHER, 'Grace')]);
      expect(calls).toBe(1);
      unsubscribe();
      await store.mutate([named(PERSON, 'Ada Lovelace')]);
      expect(calls).toBe(1);
    });
  });

  it('replaces state rather than mutating it, so React sees a change', async () => {
    await withStore(async (store) => {
      const before = store.state;
      await store.mutate([named(PERSON, 'Ada')]);
      expect(store.state).not.toBe(before);
      // The old value is still the old value. A store that mutated in place would make
      // every `useSyncExternalStore` comparison agree that nothing had changed.
      expect(before.people.size).toBe(0);
    });
  });

  it('does nothing at all for an empty batch', async () => {
    await withStore(async (store) => {
      let calls = 0;
      store.subscribe(() => {
        calls += 1;
      });
      await store.mutate([]);
      expect(calls).toBe(0);
      expect(store.head()).toBeUndefined();
    });
  });

  it('gives two overlapping mutations two distinct records', async () => {
    // The real hazard in overlapping mutations, and the one the state assertion below
    // cannot see. Both calls read the same immutable `log`, so without serialisation the
    // second overwrites the first's record *in the log* while the fold still shows both
    // people — the state looks right and the log the sync engine sends is missing an
    // operation. Worse, both would tick the same clock value and stamp two different
    // operations with one timestamp, which the log is required to reject as a collision.
    await withStore(async (store) => {
      await Promise.all([store.mutate([named(PERSON, 'Ada')]), store.mutate([named(OTHER, 'Grace')])]);
      const outgoing = store.outgoing();
      expect(outgoing.length).toBe(2);
      expect(new Set(outgoing.map((record) => record.hlc)).size).toBe(2);
    });
  });

  it('leaves state and log untouched when the write cannot be stored', async () => {
    // Durability is not decoration: the record has to be in the database before the store
    // claims the edit happened. Writing through a closed connection is the reachable way to
    // make that fail, and what must not happen is a person appearing in the UI that no
    // stored record produced.
    await withStore(async (store) => {
      store.close();
      await expect(store.mutate([named(PERSON, 'Ada')])).rejects.toThrow();
      expect(store.state.people.size).toBe(0);
      expect(store.outgoing().length).toBe(0);
    });
  });

  it('keeps serving later mutations after one fails', async () => {
    // A failed mutation must not poison the queue for every mutation after it: the tail is
    // chained with its rejection swallowed, while the caller still sees the failure. The
    // failure used here is a value that may not enter the log — recoverable, unlike a closed
    // connection, so there is something left to test afterwards.
    await withStore(async (store) => {
      const unstorable = { entity: 'person', entityId: PERSON, field: 'displayName', value: Number.NaN };
      await expect(store.mutate([unstorable])).rejects.toThrow();
      await store.mutate([named(PERSON, 'Ada')]);
      expect(store.state.people.get(PERSON)?.displayName).toBe('Ada');
    });
  });

  it('keeps both writes when two mutations overlap', async () => {
    // The reason mutations are serialised. `log` is an immutable value read at the start of
    // a mutation and written at the end, so two that overlap would both start from the same
    // log and the second would overwrite the first's record. Not awaiting in between is
    // exactly how the UI will call this.
    await withStore(async (store) => {
      await Promise.all([store.mutate([named(PERSON, 'Ada')]), store.mutate([named(OTHER, 'Grace')])]);
      expect(store.state.people.size).toBe(2);
      expect([...store.state.people.keys()].sort()).toEqual([PERSON, OTHER].sort());
    });
  });

  it('orders overlapping writes to one field deterministically', async () => {
    await withStore(async (store) => {
      await Promise.all([store.mutate([named(PERSON, 'first')]), store.mutate([named(PERSON, 'second')])]);
      // Serialised, so the second call's record carries the later timestamp and LWW keeps it.
      expect(store.state.people.get(PERSON)?.displayName).toBe('second');
    });
  });
});

describe('deleting', () => {
  it('hides a person and can bring them back', async () => {
    // A tombstone is a field write, which is why undo needs no special machinery — it is
    // one more write, and it converges the same way as any other.
    await withStore(async (store) => {
      await store.mutate([named(PERSON, 'Ada')]);
      await store.remove('person', PERSON);
      expect(store.state.people.has(PERSON)).toBe(false);
      expect(store.state.deleted.people).toContain(PERSON);

      await store.restore('person', PERSON);
      expect(store.state.people.get(PERSON)?.displayName).toBe('Ada');
      expect(store.state.deleted.people).not.toContain(PERSON);
    });
  });

  it('hides a deleted person’s charts without writing tombstones for them', async () => {
    await withStore(async (store) => {
      await store.mutate([
        named(PERSON, 'Ada'),
        { entity: 'chart', entityId: CHART, field: 'personId', value: PERSON },
      ]);
      expect(store.state.charts.has(CHART)).toBe(true);
      await store.remove('person', PERSON);
      expect(store.state.charts.has(CHART)).toBe(false);
    });
  });
});

describe('reopening', () => {
  it('comes back with the same people', async () => {
    const name = freshName();
    const first = await openStore({ name, now: ticking() });
    await first.mutate([named(PERSON, 'Ada'), named(OTHER, 'Grace')]);
    first.close();

    const second = await openStore({ name, now: ticking() });
    expect([...second.state.people.values()].map((person) => person.displayName).sort()).toEqual(['Ada', 'Grace']);
    second.close();
  });

  it('stamps the next edit after the newest record, even when the clock went backwards', async () => {
    // The failure this prevents is silent and total: a device whose clock has moved back —
    // an NTP correction, a timezone-confused OS, a restored backup — would stamp the user's
    // new edit underneath the value they were changing, and LWW would discard the edit while
    // the UI reported success.
    const name = freshName();
    const first = await openStore({ name, now: ticking(1_700_000_000_000) });
    await first.mutate([named(PERSON, 'Ada')]);
    const head = first.head();
    first.close();
    if (head === undefined) throw new Error('the record just written has no timestamp');

    const second = await openStore({ name, now: ticking(1_600_000_000_000) });
    await second.mutate([named(PERSON, 'Ada Lovelace')]);
    expect(second.state.people.get(PERSON)?.displayName).toBe('Ada Lovelace');
    const next = second.head();
    // String comparison is the whole point of the HLC encoding: fixed width, so
    // lexicographic order *is* causal order.
    expect(next !== undefined && next > head).toBe(true);
    second.close();
  });

  it('writes a snapshot once the log has grown, and resumes from it', async () => {
    const name = freshName();
    const first = await openStore({ name, now: ticking() });
    const db = await openDatabase(name);
    expect(await getSnapshot(db)).toBeUndefined();

    // 50 records is the threshold; a snapshot before then would make every keystroke pay
    // for a faster launch nobody asked for.
    for (let i = 0; i < 50; i += 1) await first.mutate([named(PERSON, `name ${String(i)}`)]);
    const snapshot = await getSnapshot(db);
    expect(snapshot?.applied).toBe(50);
    db.close();
    first.close();

    const second = await openStore({ name, now: ticking() });
    expect(second.state.people.get(PERSON)?.displayName).toBe('name 49');
    second.close();
  });
});

describe('sync surface', () => {
  it('offers every record when a peer has seen nothing', async () => {
    await withStore(async (store) => {
      await store.mutate([named(PERSON, 'Ada'), named(OTHER, 'Grace')]);
      expect(store.outgoing().length).toBe(2);
    });
  });

  it('offers only what is newer than a peer’s cursor', async () => {
    await withStore(async (store) => {
      await store.mutate([named(PERSON, 'Ada')]);
      const cursor = store.head();
      await store.mutate([named(OTHER, 'Grace')]);
      expect(store.outgoing(cursor).length).toBe(1);
      expect(store.outgoing(store.head()).length).toBe(0);
    });
  });
});

describe('resuming', () => {
  it('says it did not resume on a first run', async () => {
    await withStore(async (store) => {
      expect(store.resumedFromSnapshot).toBe(false);
      await Promise.resolve();
    });
  });

  it('says it resumed once a snapshot exists', async () => {
    const name = freshName();
    const first = await openStore({ name, now: ticking() });
    for (let i = 0; i < 50; i += 1) await first.mutate([named(PERSON, `name ${String(i)}`)]);
    first.close();

    const second = await openStore({ name, now: ticking() });
    expect(second.resumedFromSnapshot).toBe(true);
    // And the state is the same either way — the snapshot is a cache, never an authority.
    expect(second.state.people.get(PERSON)?.displayName).toBe('name 49');
    second.close();
  });
});

describe('persistence', () => {
  it('reports what the browser said', async () => {
    // Node has no Storage API, so 'unsupported' is the honest answer here — and asserting it
    // proves the store surfaces the state rather than assuming the good case.
    await withStore(async (store) => {
      expect(store.persistence.state).toBe('unsupported');
      await Promise.resolve();
    });
  });
});
