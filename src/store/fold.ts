/**
 * Fold the operation log into people and charts.
 *
 * This is where a list of mutations becomes something a screen can show. It is a pure
 * function of the records, with no IndexedDB and no clock, because it is the piece whose
 * determinism everything else depends on: two devices holding the same records must
 * materialise byte-identical state, or sync is a slow corruption rather than a feature.
 *
 * **Last write wins, per field, by timestamp.** Because timestamps are totally ordered
 * and include the writing device, there are no ties to break and the winner does not
 * depend on arrival order. Full CRDT machinery is deliberately not used: Actual Budget
 * needs it because budgets take concurrent numeric edits to shared cells, whereas here
 * one person creates a record once and rarely edits it. A per-field register keyed by
 * HLC converges just as deterministically and is a fraction of the code. That is a
 * considered simplification, not an unfinished one — do not "upgrade" it without a case
 * that actually needs it.
 *
 * **Deleting is a field, not a removal.** A device that was offline during a delete
 * would resurrect the record on its next sync if deleting meant dropping rows. So a
 * delete sets `deleted` to true and the fold hides it, which makes undo just another
 * operation, and makes an edit racing a delete resolve the way a reader would expect:
 * editing a name is not an undelete, because it writes a different register (#96).
 *
 * **Registers are the snapshot.** Startup must not be O(all history), so the register
 * map is serialisable and can be persisted and resumed from. The log stays the source of
 * truth and a snapshot is only a cache — `applyRecords` on a fresh register map rebuilds
 * it exactly, which is the recovery path when a snapshot is ever wrong, and is tested as
 * such rather than assumed.
 */
import { buildChart, type Chart } from '../domain/chart.js';
import { buildPerson, type Person } from '../domain/person.js';
import { compareHlc, type Hlc } from './hlc.js';
import { decode, type JsonValue, type OpRecord } from './ops.js';

/** The field that hides a record. A register like any other, so undo needs no new machinery. */
export const DELETED_FIELD = 'deleted';

/** One field's winning value and the timestamp that won it. */
export interface Register {
  readonly value: JsonValue;
  readonly hlc: Hlc;
}

/**
 * Registers by entity kind, then id, then field.
 *
 * Nested plain objects rather than nested maps so the whole thing serialises to JSON
 * with no conversion step, which is what makes it usable as a snapshot.
 */
export type Registers = Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, Register>>>>>>;

export const EMPTY_REGISTERS: Registers = {};

/** Why a record contributed nothing, counted so it can be reported rather than guessed at. */
export interface FoldSkips {
  /** Written by a newer client. Held in the log, uninterpretable here. */
  readonly future: number;
  /** Malformed. Not stored by the log either, but a stale snapshot may carry one. */
  readonly corrupt: number;
  /** Well-formed, but for an entity kind this build does not know. */
  readonly unknownEntity: number;
  /** Overwritten by a later write to the same field. The ordinary case. */
  readonly superseded: number;
}

export interface Applied {
  readonly registers: Registers;
  readonly skips: FoldSkips;
}

/** Entity kinds this build can materialise. Others are kept in the log and counted here. */
const KNOWN_ENTITIES: readonly string[] = ['person', 'chart'];

/**
 * Apply records to a register map.
 *
 * Records may arrive in any order and may repeat: the comparison is against the stored
 * timestamp, not against arrival, so applying the same batch twice changes nothing and
 * applying a batch out of order gives the same result as applying it in order. Both are
 * relied on by sync and by resuming from a snapshot.
 */
export function applyRecords(registers: Registers, records: readonly unknown[]): Applied {
  // Mutable working copies, copied lazily per entity so untouched branches keep their
  // existing objects and an unchanged snapshot stays cheap to write back.
  const next: Record<string, Record<string, Record<string, Register>>> = {};
  for (const [entity, byId] of Object.entries(registers)) {
    next[entity] = { ...byId };
  }
  let future = 0;
  let corrupt = 0;
  let unknownEntity = 0;
  let superseded = 0;

  for (const candidate of records) {
    const decoded = decode(candidate);
    if (decoded.kind === 'future') {
      future += 1;
      continue;
    }
    if (decoded.kind === 'corrupt') {
      corrupt += 1;
      continue;
    }
    const { entity, entityId, field, value } = decoded.body;
    if (!KNOWN_ENTITIES.includes(entity)) {
      unknownEntity += 1;
      continue;
    }

    const byId = (next[entity] ??= {});
    const fields = byId[entityId];
    const existing = fields?.[field];
    if (existing !== undefined && compareHlc(existing.hlc, decoded.spine.hlc) >= 0) {
      // Includes the equal case, which is a record already applied. Keeping the held
      // value rather than overwriting with an identical one is what makes this
      // idempotent for a snapshot that is resumed from more than once.
      superseded += 1;
      continue;
    }
    if (existing !== undefined) superseded += 1;
    byId[entityId] = { ...fields, [field]: { value, hlc: decoded.spine.hlc } };
  }

  return { registers: next, skips: { future, corrupt, unknownEntity, superseded } };
}

function valuesOf(fields: Readonly<Record<string, Register>>): ReadonlyMap<string, unknown> {
  return new Map(Object.entries(fields).map(([field, register]) => [field, register.value]));
}

function isDeleted(fields: Readonly<Record<string, Register>>): boolean {
  return fields[DELETED_FIELD]?.value === true;
}

export interface State {
  /** Live people, by id. */
  readonly people: ReadonlyMap<string, Person>;
  /** Live charts, by id. Excludes charts whose person is deleted or not yet known. */
  readonly charts: ReadonlyMap<string, Chart>;
  /**
   * Hidden by a tombstone, so "restore deleted" can offer them without a second pass.
   *
   * Materialised exactly like the live ones rather than reduced to bare ids: a restore list
   * that cannot name what it is offering to bring back is not a usable list, and the
   * registers still hold every field, so building them costs nothing extra.
   */
  readonly deleted: {
    readonly people: ReadonlyMap<string, Person>;
    readonly charts: ReadonlyMap<string, Chart>;
  };
  /** Charts naming a person this device does not hold. Retained, not lost — usually a partial sync. */
  readonly orphanCharts: readonly string[];
}

/**
 * Materialise state from registers.
 *
 * Deleting a person hides its charts **without writing tombstones for them.** Cascading
 * by writing operations would multiply every delete by the number of charts and, worse,
 * make undo lossy: restoring the person could not tell which charts were already deleted
 * on their own. Cascading at fold time keeps a delete one operation and makes undo exact.
 */
export function materialise(registers: Registers): State {
  const people = new Map<string, Person>();
  const deletedPeople = new Map<string, Person>();
  for (const [id, fields] of Object.entries(registers.person ?? {})) {
    const person = buildPerson(id, valuesOf(fields));
    if (isDeleted(fields)) deletedPeople.set(id, person);
    else people.set(id, person);
  }

  const charts = new Map<string, Chart>();
  const deletedCharts = new Map<string, Chart>();
  const orphanCharts: string[] = [];
  for (const [id, fields] of Object.entries(registers.chart ?? {})) {
    const chart = buildChart(id, valuesOf(fields));
    if (isDeleted(fields)) {
      deletedCharts.set(id, chart);
      continue;
    }
    // A chart of a person we do not have is held back rather than dropped. It is not an
    // error: the person's operations may simply not have arrived yet.
    if (people.has(chart.personId)) charts.set(id, chart);
    else orphanCharts.push(id);
  }

  return {
    people,
    charts,
    deleted: { people: deletedPeople, charts: deletedCharts },
    orphanCharts,
  };
}

/** The whole path, for a caller with no snapshot: records in, state out. */
export function fold(records: readonly unknown[]): State & { readonly skips: FoldSkips } {
  const applied = applyRecords(EMPTY_REGISTERS, records);
  return { ...materialise(applied.registers), skips: applied.skips };
}

/**
 * A snapshot: registers, the newest timestamp in them, and how many records produced it.
 *
 * The count is what makes resuming sound, and it is easy to leave out. Filtering the log
 * to "records newer than `upTo`" looks correct and is not: an operation from a peer can
 * arrive *after* the snapshot was written and still be *older* than `upTo`, and a
 * timestamp filter would skip it forever. So the snapshot records how many records were
 * at or below `upTo` when it was built, and resuming checks that the log still holds
 * exactly that many. If it holds more, something older slipped in behind us and the only
 * correct move is to rebuild — which is cheap, and correct by the same idempotence that
 * makes the fast path safe.
 */
export interface Snapshot {
  readonly registers: Registers;
  /** The newest timestamp folded in. Absent for a snapshot of an empty log. */
  readonly upTo?: Hlc;
  /** How many records at or below `upTo` were folded in. */
  readonly applied: number;
}

/**
 * Build a snapshot from registers and the log they were folded from.
 *
 * Both numbers come from the same call on purpose. Passing the count separately invites
 * the caller to use the log's own length, which is wrong whenever the newest record is
 * one the fold could not use — a future operation, say. `upTo` would then sit below that
 * record, the counts would disagree at every startup, and the snapshot would be rebuilt
 * forever while appearing to work.
 */
export function snapshotOf(registers: Registers, records: readonly OpRecord[]): Snapshot {
  let upTo: Hlc | undefined;
  for (const byId of Object.values(registers)) {
    for (const fields of Object.values(byId)) {
      for (const register of Object.values(fields)) {
        if (upTo === undefined || compareHlc(register.hlc, upTo) > 0) upTo = register.hlc;
      }
    }
  }
  if (upTo === undefined) return { registers, applied: 0 };
  const applied = records.filter((record) => compareHlc(String(record.hlc), upTo) <= 0).length;
  return { registers, upTo, applied };
}

export interface Resumed extends Applied {
  /** True when the snapshot could not be trusted and the log was folded from nothing. */
  readonly rebuilt: boolean;
}

/**
 * Continue from a snapshot, or rebuild if it cannot be trusted.
 *
 * `records` is the whole log, sorted by timestamp. The fast path applies only what is
 * newer than the snapshot; the slow path is a full fold, which must stay correct because
 * it is also the recovery path for a snapshot that is wrong for any other reason.
 */
export function resume(snapshot: Snapshot, records: readonly OpRecord[]): Resumed {
  const { upTo } = snapshot;
  const atOrBelow =
    upTo === undefined ? 0 : records.filter((record) => compareHlc(String(record.hlc), upTo) <= 0).length;
  if (upTo === undefined || atOrBelow !== snapshot.applied) {
    return { ...applyRecords(EMPTY_REGISTERS, records), rebuilt: true };
  }
  const newer = records.filter((record) => compareHlc(String(record.hlc), upTo) > 0);
  return { ...applyRecords(snapshot.registers, newer), rebuilt: false };
}
