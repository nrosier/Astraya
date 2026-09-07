/**
 * Tests for the fold.
 *
 * Three properties are load-bearing and everything else here is detail: any order of the
 * same operations gives the same state; a delete survives an offline edit; and rebuilding
 * from the log matches resuming from a snapshot. The first is what makes sync a feature
 * rather than a slow corruption, the second is the classic distributed-delete bug, and
 * the third is the recovery path for a snapshot that is ever wrong.
 */
import { describe, expect, it } from 'vitest';
import { newId } from '../src/domain/id.js';
import { createClock } from '../src/store/hlc.js';
import {
  applyRecords,
  DELETED_FIELD,
  EMPTY_REGISTERS,
  fold,
  materialise,
  resume,
  snapshotOf,
} from '../src/store/fold.js';
import { append, emptyLog, type Log, type Mutation } from '../src/store/oplog.js';
import type { OpRecord } from '../src/store/ops.js';

const A = 'a1b2c3d4e5f60718';
const B = 'b0000000000000ff';
const T0 = 1_780_963_200_000;
const PERSON = 'p-abcdefghijklmnop';
const CHART = 'c-abcdefghijklmnop';

const CIVIL = { year: 1960, month: 6, day: 15, hour: 14, minute: 30, second: 0 };
const COORDS = { latitude: 38.7478, longitude: -85.0672 };

function person(field: string, value: Mutation['value'], entityId = PERSON): Mutation {
  return { entity: 'person', entityId, field, value };
}
function chart(field: string, value: Mutation['value'], entityId = CHART): Mutation {
  return { entity: 'chart', entityId, field, value };
}

/** Write mutations as one device, one per millisecond so the order is easy to read. */
function write(nodeId: string, mutations: readonly Mutation[], from = T0): readonly OpRecord[] {
  let log: Log = emptyLog(createClock(nodeId));
  mutations.forEach((mutation, index) => {
    log = append(log, mutation, from + index).log;
  });
  return log.records;
}

const COMPLETE = [
  person('displayName', 'Ada'),
  person('civil', CIVIL),
  person('coordinates', COORDS),
  person('placeLabel', 'Vevay, Indiana'),
  person('timeAccuracy', 'recorded'),
] as const;

describe('materialising a person', () => {
  it('assembles the birth moment the chart will be cast from', () => {
    const state = fold(write(A, COMPLETE));
    const found = state.people.get(PERSON);
    expect(found?.displayName).toBe('Ada');
    expect(found?.moment?.civil).toEqual(CIVIL);
    expect(found?.moment?.coordinates).toEqual(COORDS);
    expect(found?.timeAccuracy).toBe('recorded');
    expect(found?.missing).toEqual([]);
  });

  it('keeps the last write to a field and reports the earlier one as superseded', () => {
    const applied = applyRecords(
      EMPTY_REGISTERS,
      write(A, [person('displayName', 'Ada'), person('displayName', 'Grace')]),
    );
    expect(materialise(applied.registers).people.get(PERSON)?.displayName).toBe('Grace');
    expect(applied.skips.superseded).toBe(1);
  });

  it('leaves the moment absent rather than inventing coordinates', () => {
    // {0, 0} is a real place in the Gulf of Guinea and a chart cast there looks entirely
    // ordinary. Absent is the only honest answer.
    const state = fold(write(A, [person('displayName', 'Ada'), person('civil', CIVIL)]));
    const found = state.people.get(PERSON);
    expect(found?.moment).toBeUndefined();
    expect(found?.missing).toEqual(['coordinates']);
  });

  it('refuses out-of-range and wrongly typed values without losing the rest of the person', () => {
    const state = fold(
      write(A, [
        person('displayName', 'Ada'),
        person('civil', CIVIL),
        person('coordinates', { latitude: 91, longitude: 0 }),
        person('timeAccuracy', 'guessed'),
        person('notes', 42),
      ]),
    );
    const found = state.people.get(PERSON);
    expect(found?.displayName).toBe('Ada');
    expect(found?.missing).toEqual(['coordinates']);
    expect(found?.timeAccuracy).toBe('unknown');
    expect(found?.notes).toBe('');
  });

  it('defaults an unstated time accuracy to unknown, not to exact', () => {
    // Houses and angles move about 15 degrees an hour, so treating an unstated time as
    // exact would present the least reliable part of a chart as the most confident.
    expect(
      fold(write(A, [person('civil', CIVIL), person('coordinates', COORDS)])).people.get(PERSON)?.timeAccuracy,
    ).toBe('unknown');
  });

  it('carries the offset witness so a tzdb change can be noticed later', () => {
    const witness = { offsetMinutes: -300, zone: 'America/Indiana/Vevay', tzdbFingerprint: '2026c' };
    const state = fold(write(A, [...COMPLETE, person('witness', witness)]));
    expect(state.people.get(PERSON)?.witness).toEqual(witness);
  });
});

describe('deleting', () => {
  it('hides a person without removing its operations', () => {
    const records = write(A, [...COMPLETE, person(DELETED_FIELD, true)]);
    const state = fold(records);
    expect(state.people.size).toBe(0);
    expect(state.deleted.people).toEqual([PERSON]);
  });

  it('restores a person when the tombstone is written back to false', () => {
    // Undo needs no machinery of its own: it is one more write to the same register.
    const state = fold(write(A, [...COMPLETE, person(DELETED_FIELD, true), person(DELETED_FIELD, false)]));
    expect(state.people.get(PERSON)?.displayName).toBe('Ada');
    expect(state.deleted.people).toEqual([]);
  });

  it('keeps a person deleted when another device edits them offline', () => {
    // The bug this prevents: device B, offline, edits a person that device A deleted. If
    // deleting removed rows, B's sync would resurrect them. Because the edit writes a
    // different register, it changes the name of a record that stays hidden.
    const deleted = write(A, [...COMPLETE, person(DELETED_FIELD, true)], T0);
    const editedOffline = write(B, [person('displayName', 'Grace')], T0 + 10_000);
    const state = fold([...deleted, ...editedOffline]);
    expect(state.people.size).toBe(0);
    expect(state.deleted.people).toEqual([PERSON]);
    // The edit is not lost, only hidden: undeleting shows the newer name.
    const undone = fold([...deleted, ...editedOffline, ...write(A, [person(DELETED_FIELD, false)], T0 + 20_000)]);
    expect(undone.people.get(PERSON)?.displayName).toBe('Grace');
  });

  it('hides a deleted person’s charts without writing tombstones for them', () => {
    // Cascading by writing operations would multiply a delete by the number of charts and
    // make undo lossy — restoring the person could not tell which charts had been deleted
    // on their own. Cascading at fold time keeps the delete one operation and undo exact.
    const records = [
      ...write(A, [...COMPLETE, chart('personId', PERSON), chart('kind', 'natal')]),
      ...write(A, [person(DELETED_FIELD, true)], T0 + 10_000),
    ];
    const state = fold(records);
    expect(state.charts.size).toBe(0);
    expect(state.deleted.charts).toEqual([]);
    // Restoring the person brings its charts back, because nothing was written about them.
    const undone = fold([...records, ...write(A, [person(DELETED_FIELD, false)], T0 + 20_000)]);
    expect(undone.charts.size).toBe(1);
  });
});

describe('charts', () => {
  it('collects dotted setting fields into one reproducible settings object', () => {
    const state = fold(
      write(A, [
        ...COMPLETE,
        chart('personId', PERSON),
        chart('kind', 'natal'),
        chart('settings.houseSystem', 'placidus'),
        chart('settings.zodiac', 'tropical'),
      ]),
    );
    expect(state.charts.get(CHART)?.settings).toEqual({ houseSystem: 'placidus', zodiac: 'tropical' });
  });

  it('merges settings written on two devices, because a hybrid is harmless here', () => {
    // The opposite granularity from a birth moment, on purpose: half of one device's
    // coordinates and half of another's is a place nobody was born, but half of one
    // device's settings and half of another's is a chart someone can look at.
    const state = fold([
      ...write(A, [
        ...COMPLETE,
        chart('personId', PERSON),
        chart('kind', 'natal'),
        chart('settings.houseSystem', 'koch'),
      ]),
      ...write(B, [chart('settings.zodiac', 'sidereal')], T0 + 5_000),
    ]);
    expect(state.charts.get(CHART)?.settings).toEqual({ houseSystem: 'koch', zodiac: 'sidereal' });
  });

  it('keeps an unknown setting verbatim instead of substituting a default', () => {
    // Substituting would show a different chart under the same name. The value survives
    // untouched, so the build that understands it still renders correctly.
    const state = fold(
      write(A, [...COMPLETE, chart('personId', PERSON), chart('kind', 'natal'), chart('settings.dialHarmonic', 9)]),
    );
    expect(state.charts.get(CHART)?.settings.dialHarmonic).toBe(9);
  });

  it('holds back a chart whose person has not arrived yet', () => {
    // Not an error: a partial sync can deliver a chart before the person it belongs to.
    // Dropping it would lose data that is about to make sense.
    const state = fold(write(A, [chart('personId', PERSON), chart('kind', 'natal')]));
    expect(state.charts.size).toBe(0);
    expect(state.orphanCharts).toEqual([CHART]);
  });

  it('reports a chart with no readable owner as missing one', () => {
    const state = fold(write(A, [chart('personId', 'nonsense'), chart('kind', 'natal')]));
    expect(state.orphanCharts).toEqual([CHART]);
  });
});

describe('operations the fold cannot use', () => {
  it('counts a future operation instead of interpreting or dropping it', () => {
    const [first] = write(A, COMPLETE);
    if (first === undefined) throw new Error('fixture');
    const applied = applyRecords(EMPTY_REGISTERS, [{ ...first, opVersion: 99 }]);
    expect(applied.skips.future).toBe(1);
    expect(materialise(applied.registers).people.size).toBe(0);
  });

  it('counts an entity kind it does not know', () => {
    const applied = applyRecords(EMPTY_REGISTERS, write(A, [{ ...person('window', 30), entity: 'transit-set' }]));
    expect(applied.skips.unknownEntity).toBe(1);
  });

  it('holds the value it already has when a second record claims the same timestamp', () => {
    // The log refuses a colliding timestamp, so this cannot arrive by the normal route —
    // but the fold is also fed by a snapshot and by whatever a future storage layer hands
    // it, and "first value holds" is the same answer the log gives. The alternative would
    // make the outcome depend on arrival order for exactly the records where the ordering
    // is already known to be broken.
    const [first] = write(A, [person('displayName', 'Ada')]);
    if (first === undefined) throw new Error('fixture');
    const applied = applyRecords(EMPTY_REGISTERS, [first, { ...first, value: 'Grace' }]);
    expect(materialise(applied.registers).people.get(PERSON)?.displayName).toBe('Ada');
  });

  it('counts a corrupt record, which a stale snapshot can still hand it', () => {
    expect(applyRecords(EMPTY_REGISTERS, [{ opVersion: 1, hlc: 'nope' }]).skips.corrupt).toBe(1);
  });
});

describe('convergence', () => {
  const deviceA = write(A, [...COMPLETE, chart('personId', PERSON), chart('kind', 'natal')], T0);
  const deviceB = write(B, [person('displayName', 'Grace'), person('notes', 'rectified')], T0 + 3_000);
  const all = [...deviceA, ...deviceB];

  it('gives the same state for every arrival order', () => {
    const orders = [
      all,
      [...all].reverse(),
      [...deviceB, ...deviceA],
      all.filter((_, index) => index % 2 === 0).concat(all.filter((_, index) => index % 2 === 1)),
    ];
    const states = orders.map((order) => JSON.stringify([...fold(order).people]));
    for (const state of states) expect(state).toEqual(states[0]);
  });

  it('is unchanged by applying the same records twice', () => {
    // Sync re-sends, and a snapshot may be resumed from more than once. Neither may move
    // the state.
    const once = applyRecords(EMPTY_REGISTERS, all);
    const twice = applyRecords(once.registers, all);
    expect(twice.registers).toEqual(once.registers);
    expect(twice.skips.superseded).toBe(all.length);
  });

  it('lets the later write win regardless of which device made it', () => {
    expect(fold(all).people.get(PERSON)?.displayName).toBe('Grace');
    const earlierB = write(B, [person('displayName', 'Grace')], T0 - 3_000);
    expect(fold([...deviceA, ...earlierB]).people.get(PERSON)?.displayName).toBe('Ada');
  });
});

describe('snapshots', () => {
  const records = write(A, [...COMPLETE, chart('personId', PERSON), chart('kind', 'natal')]);

  it('resumes without rebuilding when only newer records arrived', () => {
    const built = applyRecords(EMPTY_REGISTERS, records);
    const snapshot = snapshotOf(built.registers, records);
    const later = write(A, [person('notes', 'later')], T0 + 60_000);
    const resumed = resume(snapshot, [...records, ...later]);
    expect(resumed.rebuilt).toBe(false);
    expect(materialise(resumed.registers).people.get(PERSON)?.notes).toBe('later');
  });

  it('rebuilds when an older record slipped in behind the snapshot', () => {
    // This is the case a timestamp filter alone would skip forever: a peer's operation
    // that arrives after the snapshot was written but is older than everything in it.
    const built = applyRecords(EMPTY_REGISTERS, records);
    const snapshot = snapshotOf(built.registers, records);
    const older = write(B, [person('placeLabel', 'Madison, Indiana')], T0 - 60_000);
    const merged = [...older, ...records];
    const resumed = resume(snapshot, merged);
    expect(resumed.rebuilt).toBe(true);
    // And the rebuild accounts for the late record rather than losing it.
    expect(materialise(resumed.registers).people.get(PERSON)?.placeLabel).toBe('Vevay, Indiana');
    const onlyOld = resume(
      snapshotOf(applyRecords(EMPTY_REGISTERS, records.slice(0, 3)).registers, records.slice(0, 3)),
      [...older, ...records.slice(0, 3)],
    );
    expect(onlyOld.rebuilt).toBe(true);
    expect(materialise(onlyOld.registers).people.get(PERSON)?.placeLabel).toBe('Madison, Indiana');
  });

  it('matches a rebuild from the whole log exactly', () => {
    // The recovery path when a snapshot is ever wrong, so it has to be exercised rather
    // than assumed.
    const later = write(A, [person('notes', 'later')], T0 + 60_000);
    const whole = [...records, ...later];
    const snapshot = snapshotOf(applyRecords(EMPTY_REGISTERS, records).registers, records);
    expect(resume(snapshot, whole).registers).toEqual(applyRecords(EMPTY_REGISTERS, whole).registers);
  });

  it('survives a JSON round trip, because that is how it will be stored', () => {
    const snapshot = snapshotOf(applyRecords(EMPTY_REGISTERS, records).registers, records);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('rebuilds from an empty snapshot', () => {
    const resumed = resume({ registers: EMPTY_REGISTERS, applied: 0 }, records);
    expect(resumed.rebuilt).toBe(true);
    expect(materialise(resumed.registers).people.size).toBe(1);
  });

  it('does not resume forever after a future operation lands last', () => {
    // The trap the snapshot's own count exists to avoid: `upTo` cannot reach a record the
    // fold could not use, so a count taken from the log's length would disagree at every
    // startup and rebuild silently forever.
    const [first] = records;
    if (first === undefined) throw new Error('fixture');
    const future = { ...first, opVersion: 99, hlc: `000001780963299999-00000-${B}`, deviceId: B };
    const whole = [...records, future];
    const built = applyRecords(EMPTY_REGISTERS, whole);
    expect(resume(snapshotOf(built.registers, whole), whole).rebuilt).toBe(false);
  });
});

describe('generated ids', () => {
  it('are distinct, prefixed and shaped as the validators expect', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId('p')));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^p-[a-z2-7]{16}$/);
    expect(newId('c')).toMatch(/^c-/);
  });
});
