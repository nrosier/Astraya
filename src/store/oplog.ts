/**
 * The append-only operation log.
 *
 * This is the authoritative copy of a user's data. People and charts are not stored;
 * they are *derived* by folding this log (#95), which is what makes merging two
 * devices tractable — merging state requires deciding what to do about a conflict,
 * whereas merging logs is a union.
 *
 * The log is a value that is threaded through, not module state, for the same reason
 * the clock is: two logs must be able to coexist in one process so that a test can
 * play two devices against each other, and no test may depend on the order the others
 * ran in. Persistence (#93) and sync (M8) wrap this; neither is imported here, so the
 * merge rules can be tested without a database or a network.
 *
 * The timestamp is the primary key. An HLC contains the writing device and a
 * per-device counter, so it is globally unique by construction — which is what makes
 * re-sending an operation harmless, and what makes two *different* operations sharing
 * one timestamp a fault rather than a conflict to resolve.
 *
 * Records are kept sorted by timestamp, and that sort is the merge: because the
 * encoding is lexicographically ordered, the union of two logs sorted by timestamp is
 * the same sequence on both devices regardless of when each learned of what. That
 * property is what the fold relies on to be deterministic, so it is asserted here
 * rather than assumed downstream.
 */
import { compareHlc, receive, tick, type Clock, type Drift, type Hlc } from './hlc.js';
import { decode, newRecord, type JsonValue, type OpRecord } from './ops.js';

export interface Log {
  readonly clock: Clock;
  /** Every record this device holds, ascending by timestamp. Includes operations it cannot interpret. */
  readonly records: readonly OpRecord[];
}

/** A field-level mutation, before it is stamped. */
export interface Mutation {
  readonly entity: string;
  readonly entityId: string;
  readonly field: string;
  readonly value: JsonValue;
}

export function emptyLog(clock: Clock): Log {
  return { clock, records: [] };
}

/** Where to insert a record so the array stays sorted. Binary, because logs get long. */
function insertionIndex(records: readonly OpRecord[], hlc: Hlc): number {
  let low = 0;
  let high = records.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const at = records[middle];
    if (at === undefined) break;
    if (compareHlc(String(at.hlc), hlc) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * A stable string for comparing two records.
 *
 * Key order is not meaningful in JSON but `JSON.stringify` preserves it, so two
 * records that differ only in key order would compare unequal and be reported as a
 * timestamp collision. Sorting the keys is what makes the comparison about content.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

function findByHlc(records: readonly OpRecord[], hlc: Hlc): OpRecord | undefined {
  const at = records[insertionIndex(records, hlc)];
  return at?.hlc === hlc ? at : undefined;
}

function insert(records: readonly OpRecord[], record: OpRecord): readonly OpRecord[] {
  const index = insertionIndex(records, String(record.hlc));
  return [...records.slice(0, index), record, ...records.slice(index)];
}

export interface Appended {
  readonly log: Log;
  readonly record: OpRecord;
}

/**
 * Stamp and append a local mutation.
 *
 * The physical reading is passed in rather than read from `Date.now()`, so that a test
 * can drive a clock backwards — the case that matters and the one a real clock will
 * not reproduce on demand.
 */
export function append(log: Log, mutation: Mutation, physicalMillis: number): Appended {
  const stamped = tick(log.clock, physicalMillis);
  const record = newRecord({ ...mutation, hlc: stamped.hlc, deviceId: stamped.clock.nodeId });
  return { log: { clock: stamped.clock, records: insert(log.records, record) }, record };
}

/** A record that could not be stored, kept with its reason so it can be reported. */
export interface Rejection {
  readonly record: unknown;
  readonly reason: string;
}

export interface Received {
  readonly log: Log;
  /** Records new to this device, in arrival order. */
  readonly added: readonly OpRecord[];
  /** Records already held, byte-for-byte. Re-sending is expected and harmless. */
  readonly duplicates: number;
  readonly rejected: readonly Rejection[];
  readonly drift: readonly Drift[];
}

/**
 * Merge records from a peer.
 *
 * Records are validated but not interpreted: an operation from a newer client goes
 * into the log unread, because this device may be the only route by which it reaches
 * another. Dropping it is the silent data loss #97 exists to prevent.
 *
 * Corrupt records are refused rather than stored. That is the one case where something
 * does not enter the log, and it is deliberate: a record whose timestamp cannot be
 * read has no position in the order, so there is nowhere to put it. It is returned to
 * the caller instead, which is what allows a sync to quarantine and report it rather
 * than fail wholesale.
 */
export function receiveRecords(log: Log, incoming: readonly unknown[], physicalMillis: number): Received {
  let clock = log.clock;
  let records = log.records;
  const added: OpRecord[] = [];
  const rejected: Rejection[] = [];
  const drift: Drift[] = [];
  let duplicates = 0;

  for (const candidate of incoming) {
    const decoded = decode(candidate);
    if (decoded.kind === 'corrupt') {
      rejected.push({ record: candidate, reason: decoded.reason });
      continue;
    }

    const { hlc } = decoded.spine;
    const existing = findByHlc(records, hlc);
    if (existing !== undefined) {
      if (canonical(existing) === canonical(candidate)) {
        duplicates += 1;
      } else {
        // Two different operations claiming one timestamp. The HLC encoding makes this
        // impossible for a device following the rules, so it means a clock was reused
        // or a record was altered — either way, silently keeping one and discarding the
        // other would destroy an edit nobody could later account for.
        rejected.push({ record: candidate, reason: `timestamp ${hlc} is already held by a different operation` });
      }
      continue;
    }

    // The clock is advanced even for an operation we cannot interpret. Ignoring a
    // future record's timestamp would let this device stamp its next local edit as
    // though that edit had never happened, and lose the ordering between them.
    const stamped = receive(clock, hlc, physicalMillis);
    clock = stamped.clock;
    if (stamped.drift !== undefined) drift.push(stamped.drift);

    const record = candidate as OpRecord;
    records = insert(records, record);
    added.push(record);
  }

  return { log: { clock, records }, added, duplicates, rejected, drift };
}

/**
 * Records written after `cursor`, for pushing to a peer.
 *
 * Exclusive of the cursor itself, so a peer that reports its latest timestamp is not
 * sent that record again. With no cursor this is the whole log, which is what a first
 * sync needs.
 */
export function since(log: Log, cursor?: Hlc): readonly OpRecord[] {
  if (cursor === undefined) return log.records;
  const index = insertionIndex(log.records, cursor);
  const at = log.records[index];
  return log.records.slice(at?.hlc === cursor ? index + 1 : index);
}

/** The newest timestamp held, or nothing for an empty log. A peer's sync cursor. */
export function latest(log: Log): Hlc | undefined {
  const last = log.records.at(-1);
  return last === undefined ? undefined : String(last.hlc);
}

export interface Purged {
  readonly log: Log;
  /** The records taken out, so the caller can delete the same rows from storage. */
  readonly removed: readonly OpRecord[];
}

/**
 * Take every record naming this entity out of the log — an actual removal, not a tombstone.
 *
 * Only records this device can read are matched: a future-versioned record's body is
 * uninterpretable here, so it is kept rather than guessed at, the same conservative rule
 * `decode` applies everywhere else. That means a purge cannot promise to remove an
 * operation written by a newer client — an acceptable gap for a same-version device, and
 * one a future sync design (M8) will need its own answer for, since a peer that still holds
 * the original records has nothing here telling it they were purged.
 */
export function purgeEntity(log: Log, entity: string, entityId: string): Purged {
  const removed: OpRecord[] = [];
  const kept: OpRecord[] = [];
  for (const record of log.records) {
    const decoded = decode(record);
    if (decoded.kind === 'known' && decoded.body.entity === entity && decoded.body.entityId === entityId) {
      removed.push(record);
    } else {
      kept.push(record);
    }
  }
  return { log: { clock: log.clock, records: kept }, removed };
}
