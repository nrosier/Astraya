/**
 * The operation envelope: what a single mutation looks like on disk and on the wire.
 *
 * State in Astraya is a fold over an append-only log, which makes one property
 * load-bearing in a way it never is for a server-side schema: **an operation written
 * today must stay interpretable by every future version of the app.** There is no
 * migration window. A device that has been in a drawer for two years syncs, and its
 * two-year-old operations must still mean what they meant — while operations written
 * by a *newer* client, already synced to that device, must survive being handled by
 * the older code that cannot read them.
 *
 * Two rules follow, and they are the whole design:
 *
 * 1. **The spine is frozen forever; only the body is versioned.** `opVersion`, `hlc`
 *    and `deviceId` can never change shape, because an old client must be able to
 *    order and forward an operation whose body it cannot interpret. Everything that
 *    might need to change lives in the body, behind the version number.
 *
 * 2. **Shape is validated here, meaning is validated by the fold.** `entity` and
 *    `field` are an open vocabulary: a newer client adding a new kind of record does
 *    not change the operation *shape*, so it need not bump `opVersion`. If this
 *    module checked entity names against a closed list, every new entity would force
 *    a version bump, and — far worse — an older client would classify a perfectly
 *    well-formed operation as corrupt. So the fold (#95) ignores entities it does not
 *    know while the log keeps them.
 *
 * Nothing is ever dropped. An operation this version cannot use is classified, not
 * discarded: the log stores records exactly as received, and this module only reads
 * them. That is why `decode` returns a verdict instead of throwing — a corrupt record
 * must be reportable and retainable, not fatal to a whole sync.
 *
 * Tombstones and undo (#96) are a later concern: they are a `field` convention on top
 * of this envelope, not a change to it.
 */
import { decodeHlc, isHlc, isNodeId, type Hlc, type NodeId } from './hlc.js';

/**
 * The version this build writes.
 *
 * Bumping it requires an entry in `UPCASTS` from the previous version and a fixture
 * log at the old version that still replays. Both are enforced by tests, because a
 * bump without an upcast rule is a silent data loss that only shows up on a device
 * nobody is watching.
 */
export const OP_VERSION = 1;

/** A record as stored and synced: opaque keys, so an unknown body survives a round trip. */
export type OpRecord = Readonly<Record<string, unknown>>;

/**
 * A JSON value.
 *
 * The log is JSON at rest, so a value that does not survive `JSON.parse(JSON.stringify(v))`
 * unchanged cannot be stored. The two that matter in this domain are silent rather
 * than loud: `NaN` serialises to `null`, which would turn a mistyped latitude into a
 * chart cast at 0°N, and a `Date` serialises to a string, so it reads back as a
 * different type than it was written as. Both are rejected at this boundary.
 */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/**
 * How deep a value may nest.
 *
 * This bounds the recursion below, which also handles cycles: a cyclic object exceeds
 * any depth limit. Sixteen is far past anything a birth record needs — a value nested
 * deeper than that is a mistake or an attack, and either way is not a birth record.
 */
const MAX_VALUE_DEPTH = 16;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Does this value survive a JSON round trip unchanged? */
export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > MAX_VALUE_DEPTH) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  // `Number.isFinite` rather than `typeof value === 'number'`: NaN and the infinities
  // are numbers that JSON turns into null on the way out.
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, depth + 1));
  if (isPlainObject(value)) return Object.values(value).every((item) => isJsonValue(item, depth + 1));
  return false;
}

/**
 * The part of an operation that can never change shape.
 *
 * Read by every version, including versions that cannot read the body.
 */
export interface Spine {
  /** The body version this operation was written at. Never rewritten, not even after upcasting. */
  readonly opVersion: number;
  readonly hlc: Hlc;
  readonly deviceId: NodeId;
}

/** The body at the current version: one field of one record set to one value. */
export interface OpBody {
  /** Open vocabulary — `person`, `chart`, or something a newer client invented. */
  readonly entity: string;
  readonly entityId: string;
  readonly field: string;
  readonly value: JsonValue;
}

const BODY_KEYS: readonly string[] = ['entity', 'entityId', 'field', 'value'];
const SPINE_KEYS: readonly string[] = ['opVersion', 'hlc', 'deviceId'];

/** A verdict on a stored record. Never a reason to discard it. */
export type Decoded =
  /** Readable at this version. `spine.opVersion` is what it was written at; `body` is upcast to current. */
  | { readonly kind: 'known'; readonly spine: Spine; readonly body: OpBody }
  /** Written by a newer client. Order it, sync it, do not interpret it. */
  | { readonly kind: 'future'; readonly spine: Spine }
  /** Neither: the spine is unreadable, or the body is malformed at a version we claim to know. */
  | { readonly kind: 'corrupt'; readonly reason: string };

/** Upgrade a body from one version to the next. Pure; must not lose information. */
export type Upcast = (body: OpRecord) => OpRecord;

/**
 * Keyed by the version being upgraded *from*: `UPCASTS.get(1)` turns a v1 body into a
 * v2 body. Empty while v1 is the only version — the machinery exists now because
 * retrofitting it is exactly what #97 says not to do.
 */
export const UPCASTS: ReadonlyMap<number, Upcast> = new Map<number, Upcast>();

/**
 * Walk a body up the version chain.
 *
 * Exported with explicit from/to versions so the chain can be tested at versions this
 * build does not have. A test that could only exercise an empty chain would prove
 * nothing about the mechanism it is there to protect.
 *
 * A missing step is an error rather than a skip: it means a released version bumped
 * `OP_VERSION` without writing its rule, and continuing would hand the fold a body
 * in a shape it does not expect.
 */
export function upcastBody(
  fromVersion: number,
  toVersion: number,
  body: OpRecord,
  upcasts: ReadonlyMap<number, Upcast> = UPCASTS,
): OpRecord {
  let current = body;
  for (let version = fromVersion; version < toVersion; version += 1) {
    const step = upcasts.get(version);
    if (step === undefined) {
      throw new Error(`No upcast from operation version ${String(version)} to ${String(version + 1)}.`);
    }
    current = step(current);
  }
  return current;
}

function readSpine(record: OpRecord): Spine | string {
  const { opVersion, hlc, deviceId } = record;
  if (typeof opVersion !== 'number' || !Number.isInteger(opVersion) || opVersion < 1) {
    return `opVersion is not a version: ${JSON.stringify(opVersion)}`;
  }
  if (!isHlc(hlc)) return `hlc is not a timestamp: ${JSON.stringify(hlc)}`;
  if (!isNodeId(deviceId)) return `deviceId is not a device id: ${JSON.stringify(deviceId)}`;
  // `deviceId` duplicates the device id already inside `hlc`. The duplication is kept
  // because a reader must be able to attribute an operation without parsing a
  // timestamp format — but two places to hold one fact is two places to be wrong, so
  // disagreement is treated as corruption rather than picking a winner. It means an
  // operation was stamped with a clock belonging to another device, which breaks the
  // per-device monotonicity the whole ordering rests on.
  if (decodeHlc(hlc).nodeId !== deviceId) {
    return `deviceId ${deviceId} disagrees with the device in its timestamp ${hlc}`;
  }
  return { opVersion, hlc, deviceId };
}

/**
 * Name a rejected value's type without quoting the value.
 *
 * The value *is* the birth data, and these reasons are meant to be logged and
 * reported, so they carry the type and nothing more. Numbers are the exception: `NaN`
 * against `Infinity` is the actionable distinction, and neither is anyone's data.
 */
function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'object') return typeof value;
  if (Array.isArray(value)) return 'array';
  const named: unknown = (value as { constructor?: { readonly name?: unknown } }).constructor?.name;
  return typeof named === 'string' ? named : 'object';
}

function readBody(record: OpRecord): OpBody | string {
  const extra = Object.keys(record).filter((key) => !BODY_KEYS.includes(key) && !SPINE_KEYS.includes(key));
  // Tolerating an unexpected key would mean silently ignoring meaning. A newer client
  // that adds one is required to bump `opVersion`, in which case we never reach here.
  if (extra.length > 0) return `unexpected field(s) at operation version ${String(OP_VERSION)}: ${extra.join(', ')}`;
  const { entity, entityId, field, value } = record;
  if (typeof entity !== 'string' || entity === '') return `entity is not a name: ${JSON.stringify(entity)}`;
  if (typeof entityId !== 'string' || entityId === '') return `entityId is not an id: ${JSON.stringify(entityId)}`;
  if (typeof field !== 'string' || field === '') return `field is not a name: ${JSON.stringify(field)}`;
  if (!isJsonValue(value)) return `value does not survive a JSON round trip (${describeType(value)})`;
  return { entity, entityId, field, value };
}

/**
 * Classify a stored record.
 *
 * Deliberately returns a verdict rather than throwing. One bad record arriving from a
 * peer must not fail a whole sync or a whole fold — it must be skipped, kept, and
 * reported. The writer below is the opposite: it throws, because a bad value there is
 * our own bug and should be loud at the point it is made.
 */
export function decode(record: unknown, upcasts: ReadonlyMap<number, Upcast> = UPCASTS): Decoded {
  if (!isPlainObject(record)) return { kind: 'corrupt', reason: `not an operation record: ${String(record)}` };

  const spine = readSpine(record);
  if (typeof spine === 'string') return { kind: 'corrupt', reason: spine };
  if (spine.opVersion > OP_VERSION) return { kind: 'future', spine };

  let upcast: OpRecord;
  try {
    upcast = upcastBody(spine.opVersion, OP_VERSION, record, upcasts);
  } catch (error) {
    return { kind: 'corrupt', reason: error instanceof Error ? error.message : String(error) };
  }

  const body = readBody(upcast);
  if (typeof body === 'string') return { kind: 'corrupt', reason: body };
  return { kind: 'known', spine, body };
}

/**
 * Build a record to append.
 *
 * Throws on anything malformed. The log is append-only, so a bad operation cannot be
 * edited out later — it can only be compensated by another operation. Refusing to
 * write it is much cheaper than living with it.
 */
export function newRecord(fields: OpBody & { readonly hlc: Hlc; readonly deviceId: NodeId }): OpRecord {
  const record: OpRecord = {
    opVersion: OP_VERSION,
    hlc: fields.hlc,
    deviceId: fields.deviceId,
    entity: fields.entity,
    entityId: fields.entityId,
    field: fields.field,
    value: fields.value,
  };
  const verdict = decode(record);
  if (verdict.kind !== 'known') {
    throw new Error(
      `Refusing to write an operation: ${verdict.kind === 'corrupt' ? verdict.reason : 'unknown version'}`,
    );
  }
  return record;
}
