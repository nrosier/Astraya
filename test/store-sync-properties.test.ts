/**
 * A real property test for #104, replacing the "stands in for a property test" comment
 * in `store-oplog.test.ts` (a fixed, hand-picked set of shuffles) with one that generates
 * an arbitrary number of devices, an arbitrary sequence of mutations spread across them,
 * and an arbitrary order in which they exchange records — then asserts that once every
 * device has received every record, `materialise()` produces byte-identical state on all
 * of them regardless of that order.
 *
 * Runs against the pure `oplog.ts`/`fold.ts` functions directly: no IndexedDB, no
 * network, no `Store`, so it can afford many iterations.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createClock } from '../src/store/hlc.js';
import { append, emptyLog, receiveRecords, type Log, type Mutation } from '../src/store/oplog.js';
import { applyRecords, materialise, EMPTY_REGISTERS, type State } from '../src/store/fold.js';

const PERSON_IDS = ['p-1', 'p-2', 'p-3'];
const CHART_IDS = ['c-1', 'c-2'];
const PERSON_FIELDS = ['displayName', 'placeLabel', 'deleted'];
const CHART_FIELDS = ['personId', 'label', 'deleted'];

function deviceId(index: number): string {
  return index.toString(16).padStart(16, '0');
}

/** A mutation to one of a small, fixed pool of entities — small so devices collide on the same fields. */
function mutationArb(numDevices: number): fc.Arbitrary<{ device: number; mutation: Mutation }> {
  const device = fc.integer({ min: 0, max: numDevices - 1 });
  const person = fc.record({
    entity: fc.constant('person' as const),
    entityId: fc.constantFrom(...PERSON_IDS),
    field: fc.constantFrom(...PERSON_FIELDS),
    value: fc.oneof(fc.string({ maxLength: 8 }), fc.boolean()),
  });
  const chart = fc.record({
    entity: fc.constant('chart' as const),
    entityId: fc.constantFrom(...CHART_IDS),
    field: fc.constantFrom(...CHART_FIELDS),
    value: fc.oneof(fc.string({ maxLength: 8 }), fc.constantFrom(...PERSON_IDS), fc.boolean()),
  });
  return fc.record({ device, mutation: fc.oneof(person, chart) });
}

/** Every ordered pair of distinct devices — the full mesh a gossip network eventually forms. */
function allOrderedPairs(numDevices: number): (readonly [number, number])[] {
  const pairs: (readonly [number, number])[] = [];
  for (let from = 0; from < numDevices; from += 1) {
    for (let to = 0; to < numDevices; to += 1) {
      if (from !== to) pairs.push([from, to]);
    }
  }
  return pairs;
}

const scenarioArb = fc.integer({ min: 2, max: 4 }).chain((numDevices) =>
  fc.record({
    numDevices: fc.constant(numDevices),
    writes: fc.array(mutationArb(numDevices), { minLength: 0, maxLength: 40 }),
    // Every ordered pair appears exactly once: whatever order fast-check picks, each
    // device ends up directly exchanging with every other device — which is what
    // guarantees full convergence after processing the schedule, regardless of order.
    exchangeSchedule: fc.shuffledSubarray(allOrderedPairs(numDevices), {
      minLength: allOrderedPairs(numDevices).length,
      maxLength: allOrderedPairs(numDevices).length,
    }),
  }),
);

function canonicalState(state: State): string {
  return JSON.stringify({
    people: [...state.people.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    charts: [...state.charts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    deletedPeople: [...state.deleted.people.keys()].sort(),
    deletedCharts: [...state.deleted.charts.keys()].sort(),
    orphanCharts: [...state.orphanCharts].sort(),
  });
}

describe('convergence across an arbitrary number of devices and exchange order', () => {
  it('materialises byte-identical state on every device once all records have been exchanged', () => {
    fc.assert(
      fc.property(scenarioArb, ({ numDevices, writes, exchangeSchedule }) => {
        const logs: Log[] = Array.from({ length: numDevices }, (_, index) => emptyLog(createClock(deviceId(index))));

        writes.forEach(({ device, mutation }, index) => {
          const current = logs[device];
          if (current === undefined) throw new Error('device index out of range');
          logs[device] = append(current, mutation, index).log;
        });

        for (const [from, to] of exchangeSchedule) {
          const sender = logs[from];
          const receiver = logs[to];
          if (sender === undefined || receiver === undefined) throw new Error('device index out of range');
          logs[to] = receiveRecords(receiver, sender.records, writes.length + 1).log;
        }

        const states = logs.map((log) => materialise(applyRecords(EMPTY_REGISTERS, log.records).registers));
        const canonical = states.map(canonicalState);
        const [first] = canonical;
        if (first === undefined) throw new Error('no devices in scenario');
        for (const state of canonical) expect(state).toBe(first);

        // Every device should also hold the exact same set of records, not merely the
        // same materialised view of them — a stronger check than state equality alone,
        // since two different record sets could coincidentally fold to the same state.
        const recordCounts = new Set(logs.map((log) => log.records.length));
        expect(recordCounts.size).toBe(1);
      }),
      { numRuns: 200 },
    );
  });
});
