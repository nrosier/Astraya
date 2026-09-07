/**
 * Tests for hybrid logical clocks.
 *
 * The clock decides which of two conflicting edits survives, so the interesting
 * cases are all the ones a real clock will not reproduce on demand: time going
 * backwards, two devices stamping the same millisecond, a peer that is an hour
 * ahead. Every physical reading here is passed in for exactly that reason.
 *
 * The property that must hold throughout: **an operation stamped later never sorts
 * earlier**. If that breaks, last-write-wins silently resurrects overwritten data,
 * and nothing about the result looks wrong.
 */
import { describe, expect, it } from 'vitest';
import {
  DRIFT_REPORT_THRESHOLD_MS,
  type Clock,
  compareHlc,
  createClock,
  decodeHlc,
  encodeHlc,
  randomNodeId,
  receive,
  tick,
} from '../src/store/hlc.js';

const A = 'a1b2c3d4e5f60718';
const B = 'b0000000000000ff';
/** An arbitrary but fixed physical reading: 2026-06-09T00:00:00Z. */
const T0 = 1_780_963_200_000;

/** Stamp a run of local events, returning the timestamps in the order issued. */
function run(clock: Clock, readings: readonly number[]): { clock: Clock; stamps: string[] } {
  const stamps: string[] = [];
  let current = clock;
  for (const reading of readings) {
    const result = tick(current, reading);
    current = result.clock;
    stamps.push(result.hlc);
  }
  return { clock: current, stamps };
}

describe('encoding', () => {
  it('round-trips', () => {
    const clock = { millis: T0, counter: 7, nodeId: A };
    expect(decodeHlc(encodeHlc(clock))).toEqual(clock);
  });

  it('is fixed width, so lexicographic order is causal order', () => {
    // The whole design rests on this: if the width varied, `'9...' > '10...'` would
    // put a later timestamp first and every comparison in the app would be wrong.
    const early = encodeHlc({ millis: 9, counter: 0, nodeId: A });
    const late = encodeHlc({ millis: 10, counter: 0, nodeId: A });
    expect(early.length).toBe(late.length);
    expect(early < late).toBe(true);
    expect(compareHlc(early, late)).toBe(-1);
  });

  it('orders by millis, then counter, then device', () => {
    const stamps = [
      encodeHlc({ millis: T0 + 1, counter: 0, nodeId: A }),
      encodeHlc({ millis: T0, counter: 1, nodeId: A }),
      encodeHlc({ millis: T0, counter: 0, nodeId: B }),
      encodeHlc({ millis: T0, counter: 0, nodeId: A }),
    ];
    expect([...stamps].sort(compareHlc)).toEqual([stamps[3], stamps[2], stamps[1], stamps[0]]);
  });

  it('rejects malformed timestamps rather than returning a plausible clock', () => {
    for (const bad of ['', 'nonsense', `${'0'.repeat(18)}-00000-NOTHEX0000000000`, '123-00000-a1b2c3d4e5f60718']) {
      expect(() => decodeHlc(bad)).toThrow(/Not a timestamp/);
    }
  });

  it('rejects a device id that is not fixed-width hex', () => {
    for (const bad of ['short', 'A1B2C3D4E5F60718', 'a1b2c3d4e5f6071']) {
      expect(() => createClock(bad)).toThrow(/Not a device id/);
    }
  });

  it('generates distinct device ids of the accepted shape', () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomNodeId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(() => createClock(id)).not.toThrow();
  });
});

describe('local events', () => {
  it('separates events inside one millisecond by counter', () => {
    const { stamps } = run(createClock(A), [T0, T0, T0]);
    expect(stamps.map((s) => decodeHlc(s).counter)).toEqual([0, 1, 2]);
    expect([...stamps].sort(compareHlc)).toEqual(stamps);
  });

  it('resets the counter once physical time moves on', () => {
    const { stamps } = run(createClock(A), [T0, T0, T0 + 1]);
    expect(decodeHlc(stamps[2] ?? '').counter).toBe(0);
    expect(decodeHlc(stamps[2] ?? '').millis).toBe(T0 + 1);
  });

  it('keeps issuing increasing stamps when the physical clock goes backwards', () => {
    // The case this type exists for. An NTP correction or a resumed laptop can move
    // the wall clock back by minutes; a timestamp that follows it would make an older
    // edit win from then on, and would keep winning.
    const { stamps } = run(createClock(A), [T0, T0 - 60_000, T0 - 120_000, T0 - 1]);
    expect([...stamps].sort(compareHlc)).toEqual(stamps);
    // Logical time holds at the high-water mark rather than following the clock down.
    expect(stamps.map((s) => decodeHlc(s).millis)).toEqual([T0, T0, T0, T0]);
    expect(stamps.map((s) => decodeHlc(s).counter)).toEqual([0, 1, 2, 3]);
  });

  it('carries a counter overflow into the millisecond rather than wrapping', () => {
    // Wrapping would emit a stamp that sorts before the previous one, which would
    // silently resurrect overwritten data. 100,000 events in a millisecond means a
    // bug elsewhere, so the guard just has to not make it worse.
    const saturated = { millis: T0, counter: 99_999, nodeId: A };
    const next = tick(saturated, T0);
    expect(decodeHlc(next.hlc).millis).toBe(T0 + 1);
    expect(decodeHlc(next.hlc).counter).toBe(0);
    expect(compareHlc(next.hlc, encodeHlc(saturated))).toBe(1);
  });
});

describe('receiving a peer timestamp', () => {
  it('sorts our next write after an operation we have seen', () => {
    // Causality: whatever we write after seeing a remote edit must lose to nothing
    // it already beat, and must beat the edit itself.
    const remote = encodeHlc({ millis: T0 + 5000, counter: 3, nodeId: B });
    const merged = receive(createClock(A), remote, T0);
    expect(compareHlc(merged.hlc, remote)).toBe(1);

    const next = tick(merged.clock, T0);
    expect(compareHlc(next.hlc, merged.hlc)).toBe(1);
    expect(compareHlc(next.hlc, remote)).toBe(1);
  });

  it('breaks a same-millisecond, same-counter tie by taking the higher counter', () => {
    const clock = { millis: T0, counter: 4, nodeId: A };
    const remote = encodeHlc({ millis: T0, counter: 9, nodeId: B });
    const merged = receive(clock, remote, T0);
    expect(decodeHlc(merged.hlc)).toEqual({ millis: T0, counter: 10, nodeId: A });
  });

  it('keeps our own device id, so a peer cannot stamp on our behalf', () => {
    const merged = receive(createClock(A), encodeHlc({ millis: T0 + 1, counter: 0, nodeId: B }), T0);
    expect(decodeHlc(merged.hlc).nodeId).toBe(A);
  });

  it('reports a peer whose clock is far ahead, while still adopting it', () => {
    // Adopting is required — refusing would break convergence. Being quiet about it
    // is what we refuse: a device set a year ahead wins every conflict until real
    // time catches up, and only the server can rule on that (#105).
    const ahead = DRIFT_REPORT_THRESHOLD_MS + 60_000;
    const remote = encodeHlc({ millis: T0 + ahead, counter: 0, nodeId: B });
    const merged = receive(createClock(A), remote, T0);

    expect(merged.drift?.aheadByMs).toBe(ahead);
    expect(merged.drift?.remote).toBe(remote);
    expect(decodeHlc(merged.hlc).millis).toBe(T0 + ahead);
  });

  it('stays quiet about ordinary unsynchronised clocks', () => {
    const remote = encodeHlc({ millis: T0 + 30_000, counter: 0, nodeId: B });
    expect(receive(createClock(A), remote, T0).drift).toBeUndefined();
  });

  it('does not report a peer that is behind us', () => {
    const remote = encodeHlc({ millis: T0 - 10 * DRIFT_REPORT_THRESHOLD_MS, counter: 0, nodeId: B });
    const merged = receive(createClock(A), remote, T0);
    expect(merged.drift).toBeUndefined();
    expect(decodeHlc(merged.hlc).millis).toBe(T0);
  });
});

describe('two devices interleaving', () => {
  it('produces one total order both devices agree on', () => {
    // The convergence property in miniature: two devices, each writing and each
    // seeing some of the other's writes, must be able to sort the combined log
    // identically. If they cannot, they materialise different state from one log.
    let a = createClock(A);
    let b = createClock(B);
    const log: string[] = [];

    const localA = (at: number): void => {
      const t = tick(a, at);
      a = t.clock;
      log.push(t.hlc);
    };
    const localB = (at: number): void => {
      const t = tick(b, at);
      b = t.clock;
      log.push(t.hlc);
    };
    const syncBFromA = (at: number): void => {
      const t = receive(b, log[log.length - 1] ?? '', at);
      b = t.clock;
    };

    localA(T0);
    localA(T0); // same millisecond as the previous write
    syncBFromA(T0 - 5000); // B's clock is behind, and it has seen A's second write
    localB(T0 - 5000);
    localA(T0 + 1);
    localB(T0 - 4000);

    const sorted = [...log].sort(compareHlc);
    expect(new Set(sorted).size).toBe(log.length);
    // B's write after syncing must sort after the A write it saw, despite B's clock
    // reading five seconds earlier than A's.
    expect(sorted.indexOf(log[3] ?? '')).toBeGreaterThan(sorted.indexOf(log[1] ?? ''));
    // Sorting is stable regardless of the order the log arrives in.
    expect([...log].reverse().sort(compareHlc)).toEqual(sorted);
  });
});
