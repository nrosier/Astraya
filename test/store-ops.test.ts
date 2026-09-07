/**
 * Tests for the operation envelope.
 *
 * The interesting cases here are all about *time*: operations written by an older
 * build, and operations written by a newer one. Both have to work on a device that has
 * been offline for a year, and neither can be exercised by running the current code
 * against itself — so the version chain is driven with synthetic versions, and the old
 * shape is a committed fixture rather than something this test generates.
 */
import { describe, expect, it } from 'vitest';
import fixture from './fixtures/oplog-v1.json' with { type: 'json' };
import {
  decode,
  isJsonValue,
  newRecord,
  OP_VERSION,
  upcastBody,
  type OpRecord,
  type Upcast,
} from '../src/store/ops.js';

const DEVICE = 'a1b2c3d4e5f60718';
const OTHER = 'b0000000000000ff';
const STAMP = `000001780963200000-00000-${DEVICE}`;

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    opVersion: OP_VERSION,
    hlc: STAMP,
    deviceId: DEVICE,
    entity: 'person',
    entityId: 'p-1',
    field: 'name',
    value: 'Ada',
    ...overrides,
  };
}

describe('decoding an operation', () => {
  it('reads a well-formed record', () => {
    const decoded = decode(record());
    expect(decoded.kind).toBe('known');
    if (decoded.kind !== 'known') return;
    expect(decoded.spine).toEqual({ opVersion: 1, hlc: STAMP, deviceId: DEVICE });
    expect(decoded.body).toEqual({ entity: 'person', entityId: 'p-1', field: 'name', value: 'Ada' });
  });

  it('accepts an entity name it has never heard of', () => {
    // The open vocabulary is the point: a newer client adding a new kind of record does
    // not change the operation shape, so it does not bump the version, and this build
    // must keep and forward the operation rather than call it corrupt. Whether it
    // *means* anything is the fold's problem.
    expect(decode(record({ entity: 'transit-set', field: 'window' })).kind).toBe('known');
  });

  it('rejects a record that is not a record', () => {
    for (const value of [null, undefined, 42, 'op', [], new Date()]) {
      expect(decode(value).kind).toBe('corrupt');
    }
  });

  it('names what was wrong, so a quarantined record can be diagnosed', () => {
    const decoded = decode(record({ hlc: 'yesterday' }));
    expect(decoded.kind).toBe('corrupt');
    if (decoded.kind !== 'corrupt') return;
    expect(decoded.reason).toMatch(/hlc is not a timestamp/);
  });

  it('rejects a spine that is missing or malformed', () => {
    expect(decode(record({ opVersion: undefined })).kind).toBe('corrupt');
    expect(decode(record({ opVersion: 0 })).kind).toBe('corrupt');
    expect(decode(record({ opVersion: 1.5 })).kind).toBe('corrupt');
    expect(decode(record({ opVersion: '1' })).kind).toBe('corrupt');
    expect(decode(record({ hlc: undefined })).kind).toBe('corrupt');
    expect(decode(record({ deviceId: 'ZZZ' })).kind).toBe('corrupt');
  });

  it('rejects a deviceId that disagrees with the device inside its timestamp', () => {
    // This means an operation was stamped with another device's clock, which breaks
    // the per-device monotonicity the ordering depends on. Cheap to check, and
    // impossible to notice later.
    const decoded = decode(record({ deviceId: OTHER }));
    expect(decoded.kind).toBe('corrupt');
    if (decoded.kind !== 'corrupt') return;
    expect(decoded.reason).toMatch(/disagrees with the device/);
  });

  it('rejects an empty entity, id or field', () => {
    expect(decode(record({ entity: '' })).kind).toBe('corrupt');
    expect(decode(record({ entityId: '' })).kind).toBe('corrupt');
    expect(decode(record({ field: '' })).kind).toBe('corrupt');
  });

  it('rejects an unexpected field rather than ignoring it', () => {
    // Ignoring it would mean silently discarding meaning. A newer client that adds a
    // field is required to bump the version, and then we take the `future` path.
    const decoded = decode(record({ colour: 'red' }));
    expect(decoded.kind).toBe('corrupt');
    if (decoded.kind !== 'corrupt') return;
    expect(decoded.reason).toMatch(/unexpected field\(s\).*colour/);
  });
});

describe('values that must not reach the log', () => {
  it('accepts the JSON values a birth record actually needs', () => {
    for (const value of ['Ada', 0, -85.0672, true, false, null, [1, 2], { latitude: 1, nested: { deep: [null] } }]) {
      expect(isJsonValue(value)).toBe(true);
      expect(decode(record({ value })).kind).toBe('known');
    }
  });

  it('rejects NaN and the infinities, which JSON turns into null', () => {
    // The failure this prevents is silent and plausible: a mistyped latitude of NaN
    // syncs as null and comes back as a chart cast at 0 degrees north.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(isJsonValue(value)).toBe(false);
      expect(decode(record({ value })).kind).toBe('corrupt');
    }
  });

  it('rejects a Date, which reads back as a different type than it was written as', () => {
    expect(isJsonValue(new Date())).toBe(false);
    expect(isJsonValue(new Map())).toBe(false);
    expect(isJsonValue(undefined)).toBe(false);
    expect(isJsonValue(() => 1)).toBe(false);
    expect(isJsonValue(1n)).toBe(false);
  });

  it('rejects a nested value hiding undefined or NaN inside it', () => {
    expect(isJsonValue({ coordinates: { latitude: Number.NaN } })).toBe(false);
    expect(isJsonValue([1, [2, [undefined]]])).toBe(false);
  });

  it('rejects a cyclic value instead of recursing forever', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(isJsonValue(cycle)).toBe(false);
  });
});

describe('writing an operation', () => {
  it('stamps the current version', () => {
    const written = newRecord({
      hlc: STAMP,
      deviceId: DEVICE,
      entity: 'person',
      entityId: 'p-1',
      field: 'name',
      value: 'Ada',
    });
    expect(written.opVersion).toBe(OP_VERSION);
    expect(decode(written).kind).toBe('known');
  });

  it('throws rather than appending something unreadable', () => {
    // The asymmetry with `decode` is deliberate. The log is append-only, so a bad
    // operation cannot be edited out later, only compensated for — refusing to write
    // it is far cheaper than living with it.
    expect(() =>
      newRecord({ hlc: STAMP, deviceId: DEVICE, entity: 'person', entityId: 'p-1', field: 'lat', value: Number.NaN }),
    ).toThrow(/Refusing to write/);
    expect(() =>
      newRecord({ hlc: STAMP, deviceId: OTHER, entity: 'person', entityId: 'p-1', field: 'name', value: 'Ada' }),
    ).toThrow(/Refusing to write/);
  });
});

describe('operations from a newer client', () => {
  it('preserves an unknown version instead of dropping it', () => {
    // The device that would lose data here is the one nobody is looking at: it synced
    // a newer client's operations, then failed to hand them back. The log keeps the
    // record; this classification is what stops the fold from guessing at it.
    const decoded = decode(record({ opVersion: OP_VERSION + 1, somethingNew: true }));
    expect(decoded.kind).toBe('future');
    if (decoded.kind !== 'future') return;
    expect(decoded.spine.hlc).toBe(STAMP);
  });

  it('classifies by version before looking at the body at all', () => {
    // A future body may be any shape, including one this version would call corrupt.
    // Reading the spine first is what makes forwarding possible.
    expect(decode({ opVersion: 99, hlc: STAMP, deviceId: DEVICE, payload: { anything: [1, 2, 3] } }).kind).toBe(
      'future',
    );
  });
});

describe('upcasting older bodies', () => {
  // Driven with synthetic versions on purpose: v1 is the only version that exists, so
  // a test restricted to the real chain would exercise an empty loop and prove nothing
  // about the mechanism it exists to protect.
  const renameNameToFullName: Upcast = (body) => {
    const { name, ...rest } = body;
    return { ...rest, field: body.field === 'name' ? 'fullName' : body.field, value: name ?? body.value };
  };
  const bump: Upcast = (body) => ({ ...body, hops: Number(body.hops ?? 0) + 1 });

  it('is a no-op when the version already matches', () => {
    const body: OpRecord = { field: 'name' };
    expect(upcastBody(3, 3, body, new Map([[3, bump]]))).toEqual(body);
  });

  it('applies one step', () => {
    expect(upcastBody(1, 2, { field: 'name', value: 'Ada' }, new Map([[1, renameNameToFullName]]))).toEqual({
      field: 'fullName',
      value: 'Ada',
    });
  });

  it('walks several versions in order', () => {
    const chain = new Map<number, Upcast>([
      [1, bump],
      [2, bump],
      [3, bump],
    ]);
    expect(upcastBody(1, 4, { field: 'x' }, chain)).toEqual({ field: 'x', hops: 3 });
  });

  it('refuses to skip a missing step', () => {
    // A gap means a released version bumped OP_VERSION without writing its rule.
    // Skipping would hand the fold a body in a shape it does not expect.
    const chain = new Map<number, Upcast>([[1, bump]]);
    expect(() => upcastBody(1, 3, { field: 'x' }, chain)).toThrow(/No upcast from operation version 2 to 3/);
  });

  it('is not consulted at all while one version exists', () => {
    // Being straight about coverage: with OP_VERSION at 1, the only decodable version
    // is 1, so `decode` always walks zero steps and its broken-chain branch is
    // unreachable. Passing a chain that would corrupt the body proves that. The
    // assertion below is a tripwire: when OP_VERSION moves, this test must be replaced
    // by one that decodes a real older record, and a fixture log at the old version
    // must be committed alongside it.
    expect(decode(record(), new Map<number, Upcast>([[1, bump]])).kind).toBe('known');
    expect(decode(record(), new Map()).kind).toBe('known');
    expect(OP_VERSION).toBe(1);
  });
});

describe('the committed v1 log', () => {
  // This is the regression test #97 asks to run forever. It does not check that the
  // fixture decodes today — it checks that a *future* build still can.
  it('still decodes, every operation of it', () => {
    const verdicts = fixture.ops.map((op) => decode(op));
    expect(verdicts.every((v) => v.kind === 'known')).toBe(true);
    expect(verdicts).toHaveLength(5);
  });

  it('round-trips through JSON without changing any value', () => {
    // The log is JSON at rest, so anything that shifts on a round trip is a value that
    // was never really storable.
    for (const op of fixture.ops) {
      expect(JSON.parse(JSON.stringify(op))).toEqual(op);
    }
  });

  it('carries the values a chart is actually computed from', () => {
    const fields = fixture.ops.filter((op) => op.entity === 'person').map((op) => op.field);
    expect(fields).toContain('civil');
    expect(fields).toContain('coordinates');
    expect(fields).toContain('offsetOverrideMinutes');
  });
});
