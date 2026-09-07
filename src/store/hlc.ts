/**
 * Hybrid logical clocks.
 *
 * Every operation in the log carries one of these, and field-level last-write-wins
 * resolves conflicts by comparing them. So this module decides which of two edits
 * survives, which makes it the most consequential file in the store.
 *
 * A hybrid logical clock is a physical millisecond reading, a counter for events
 * inside the same millisecond, and the id of the device that stamped it. It gives us
 * two things a plain `Date.now()` cannot:
 *
 * 1. **Monotonicity per device.** Wall clocks go backwards — NTP corrections, a
 *    laptop resuming from sleep, a user changing the date. A timestamp that goes
 *    backwards makes an older edit win, permanently. The logical part never
 *    decreases, whatever the physical clock does.
 * 2. **A total order across devices.** Two devices editing offline produce
 *    timestamps that must order deterministically or the two devices materialise
 *    different state from the same log. The device id breaks ties, so the order is
 *    total rather than merely partial.
 *
 * What it deliberately does *not* fix is a device whose clock is genuinely wrong —
 * a phone set a year ahead stamps operations a year ahead, and wins every conflict
 * until real time catches up. No client-side clock can detect that about itself, so
 * the server stamps its own receive time and rejects implausible skew (#105). What
 * this module does is *notice* when a peer's timestamp is far ahead of ours and say
 * so, because adopting it is required for convergence but should not be silent.
 *
 * The clock is a value that callers thread through, not module state. Hidden mutable
 * state here would make tests order-dependent and make two stores in one process
 * (which is exactly what a sync test needs) interfere.
 */

/**
 * A timestamp, encoded so that lexicographic string order *is* causal order.
 *
 * `000001749427200000-00000-a1b2c3d4e5f60718`
 *
 * The encoding is load-bearing rather than cosmetic. IndexedDB compares keys, the
 * operation log is read in order, and sync asks for "everything after this cursor" —
 * all of which are string comparisons if the format is fixed-width. Comparing parsed
 * structs instead would mean every one of those paths needs the parser to agree, and
 * a fixed-width string cannot disagree with itself.
 *
 * Field widths matter for a specific reason: the moment a field needs one more digit
 * than its padding, the sort order breaks, and it breaks quietly — a longer number
 * sorts *after* a shorter one only by accident of the digits. So both numeric fields
 * are padded far wider than they can plausibly need. 18 digits of milliseconds
 * reaches beyond the year 33000 (13 would run out in 2286), and 5 digits of counter
 * allow 100,000 events inside a single millisecond. The device id is fixed-width so
 * the tiebreak between two devices cannot depend on how long their ids happen to be.
 */
export type Hlc = string;

const MILLIS_DIGITS = 18;
const COUNTER_DIGITS = 5;
const MAX_COUNTER = 10 ** COUNTER_DIGITS - 1;

/** A device id: 16 lowercase hex characters. Fixed width, so ties break cleanly. */
export type NodeId = string;

const NODE_ID_PATTERN = /^[0-9a-f]{16}$/;

export interface Clock {
  /** The logical millisecond reading. Never decreases. */
  readonly millis: number;
  /** Events already stamped within `millis`. */
  readonly counter: number;
  readonly nodeId: NodeId;
}

/**
 * How far ahead of us a peer's clock may be before we say so.
 *
 * Five minutes is chosen to sit above ordinary unsynchronised-clock error — a
 * device that has never talked to an NTP server is typically seconds to a couple of
 * minutes out — and well below the point where it changes which edit wins in a way a
 * person would notice. It is a reporting threshold, not a rejection threshold:
 * rejecting would break convergence, and only the server is in a position to judge
 * (#105).
 */
export const DRIFT_REPORT_THRESHOLD_MS = 5 * 60 * 1000;

export interface Drift {
  /** How far ahead of our physical clock the remote timestamp was, in ms. */
  readonly aheadByMs: number;
  readonly remote: Hlc;
}

/** A clock advance: the new clock, the stamp it produced, and any drift noticed. */
export interface Tick {
  readonly clock: Clock;
  readonly hlc: Hlc;
  readonly drift?: Drift;
}

export function createClock(nodeId: NodeId, millis = 0): Clock {
  if (!NODE_ID_PATTERN.test(nodeId)) {
    throw new Error(`Not a device id: ${nodeId}. Expected 16 lowercase hex characters.`);
  }
  return { millis, counter: 0, nodeId };
}

/** Generate a device id. Identity only — never a secret, never an authenticator. */
export function randomNodeId(): NodeId {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function encodeHlc(clock: Clock): Hlc {
  return [
    String(clock.millis).padStart(MILLIS_DIGITS, '0'),
    String(clock.counter).padStart(COUNTER_DIGITS, '0'),
    clock.nodeId,
  ].join('-');
}

export function decodeHlc(hlc: Hlc): Clock {
  const parts = hlc.split('-');
  const [millis, counter, nodeId] = parts;
  if (
    parts.length !== 3 ||
    millis === undefined ||
    counter === undefined ||
    nodeId === undefined ||
    millis.length !== MILLIS_DIGITS ||
    counter.length !== COUNTER_DIGITS ||
    !NODE_ID_PATTERN.test(nodeId) ||
    !/^\d+$/.test(millis) ||
    !/^\d+$/.test(counter)
  ) {
    throw new Error(`Not a timestamp: ${hlc}`);
  }
  return { millis: Number(millis), counter: Number(counter), nodeId };
}

/**
 * Stamp a local event.
 *
 * The physical reading is passed in rather than read from `Date.now()` so that tests
 * can drive a clock backwards, which is the case that matters and the case a real
 * clock will not reproduce on demand.
 */
export function tick(clock: Clock, physicalMillis: number): Tick {
  const millis = Math.max(clock.millis, physicalMillis);
  // Same logical millisecond: the counter is the only thing separating these two
  // events, so it must advance even though no time has passed.
  const counter = millis === clock.millis ? clock.counter + 1 : 0;
  return advance({ millis, counter, nodeId: clock.nodeId });
}

/**
 * Merge a timestamp received from another device.
 *
 * Adopting a remote reading that is ahead of ours is what makes the order causal:
 * an operation we saw before writing must sort before what we write next. It also
 * means a peer with a fast clock drags ours forward, hence the drift report.
 */
export function receive(clock: Clock, remote: Hlc, physicalMillis: number): Tick {
  const other = decodeHlc(remote);
  const millis = Math.max(clock.millis, other.millis, physicalMillis);

  let counter: number;
  if (millis === clock.millis && millis === other.millis) counter = Math.max(clock.counter, other.counter) + 1;
  else if (millis === clock.millis) counter = clock.counter + 1;
  else if (millis === other.millis) counter = other.counter + 1;
  else counter = 0;

  const result = advance({ millis, counter, nodeId: clock.nodeId });
  const aheadByMs = other.millis - physicalMillis;
  return aheadByMs > DRIFT_REPORT_THRESHOLD_MS ? { ...result, drift: { aheadByMs, remote } } : result;
}

/**
 * Carry a counter overflow into the millisecond field.
 *
 * Wrapping the counter would produce a timestamp that sorts *before* the one just
 * issued, which is the one thing this type promises cannot happen; a wrapped counter
 * would silently resurrect an overwritten value. Borrowing a millisecond from the
 * future keeps the order intact and costs nothing observable — 100,000 events inside
 * one millisecond is not a case that arises from a person editing birth records, so
 * this is a guard against a bug elsewhere rather than a live concern.
 */
function advance(clock: Clock): Tick {
  const carried =
    clock.counter <= MAX_COUNTER
      ? clock
      : { millis: clock.millis + Math.floor(clock.counter / (MAX_COUNTER + 1)), counter: 0, nodeId: clock.nodeId };
  return { clock: carried, hlc: encodeHlc(carried) };
}

/** Negative if `a` happened before `b`. Suitable for `Array.prototype.sort`. */
export function compareHlc(a: Hlc, b: Hlc): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
