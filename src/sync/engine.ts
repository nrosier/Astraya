/**
 * The client half of sync: a push/pull loop against the opaque relay in
 * `server/ops/routes.ts`. Runs only while signed in — `session-context.tsx`
 * creates one on sign-in and closes it on sign-out.
 *
 * Every step here is safe to interrupt at any point (#103): nothing is marked
 * done — the cursor moved, a record merged — until the network call that did
 * it has already succeeded, and a page reload just runs the same loop again
 * from wherever the durable cursor last got to.
 */
import { isHlc, isNodeId, type Hlc, type NodeId } from '../store/hlc.js';
import type { OpRecord } from '../store/ops.js';
import type { Store, SyncCursor } from '../store/store.js';
import type { SyncState } from '../ui/status.js';

/** Matches the server's own `MAX_BATCH_SIZE`/`MAX_PAGE_SIZE` (`server/ops/routes.ts`). */
const MAX_PAGE_SIZE = 500;

/** Coalesces a burst of local edits into one push instead of one per keystroke. */
const PUSH_DEBOUNCE_MS = 1_000;

/** Picks up a peer's changes, and retries a past failure, even with nothing local to push. */
const POLL_INTERVAL_MS = 30_000;

/** First retry after a failure (#106): fast enough that a blip barely shows, never a tight loop. */
const BASE_RETRY_MS = 1_000;
/** Ceiling on backoff growth — a prolonged outage retries every 5 minutes, not slower and slower forever. */
const MAX_RETRY_MS = 5 * 60_000;

export interface SyncEngine {
  /** Live — read it again after `subscribe` fires. */
  readonly status: SyncState;
  /** Local records the server has not yet acknowledged. */
  pending(): number;
  subscribe(listener: () => void): () => void;
  close(): void;
}

export interface SyncEngineOptions {
  readonly store: Store;
  /**
   * The server no longer honours this device's session (#106) — retrying the same request
   * would just fail the same way again. Called at most once per distinct failure episode
   * (not on every retry), so a caller can prompt re-authentication without being flooded.
   */
  readonly onUnauthorized?: () => void;
}

export type SyncErrorKind =
  /** `fetch` itself threw — no request reached the server at all. */
  | 'offline'
  /** The session is no longer valid; retrying it will not help. */
  | 'unauthorized'
  /** The server rejected an operation's HLC as clock-skewed (#105) — retrying won't change that op's timestamp. */
  | 'clock-skew'
  /** 5xx: the server's problem, plausibly transient. */
  | 'server'
  /** 2xx but the body wasn't the shape expected — a protocol mismatch, not a network condition. */
  | 'malformed'
  /** Any other non-2xx (e.g. a batch too large, malformed ops) — a bug in this client, not a blip. */
  | 'rejected';

/** Thrown by `request()` below; carries which of #106's distinct failure kinds this was. */
export class SyncError extends Error {
  readonly kind: SyncErrorKind;

  constructor(kind: SyncErrorKind, message: string) {
    super(message);
    this.name = 'SyncError';
    this.kind = kind;
  }
}

interface OpWire {
  readonly hlc: Hlc;
  readonly deviceId: NodeId;
  readonly opVersion: number;
  readonly payload: string;
}

interface PullRow {
  readonly seq: number;
  readonly hlc: string;
  readonly deviceId: string;
  readonly opVersion: number;
  readonly payload: string;
}

/** UTF-8-safe base64: `btoa` alone mangles anything outside Latin-1, which most names are not. */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * The record's spine passes through verbatim; everything else becomes the relay's opaque
 * payload. Every record `store.outgoing()` returns was produced by this device's own
 * `append` or a peer's `receiveRecords` — both already guarantee a valid spine — so a
 * missing one here is this function's own bug, not a peer's malformed data.
 */
function toWire(record: OpRecord): OpWire {
  const { opVersion, hlc, deviceId, ...body } = record;
  if (typeof opVersion !== 'number' || !isHlc(hlc) || !isNodeId(deviceId)) {
    throw new Error('a record from the local log is missing a valid spine');
  }
  return { opVersion, hlc, deviceId, payload: toBase64(JSON.stringify(body)) };
}

/** The reverse: a relay row, reassembled into the flat shape `Store.receive` expects. */
function fromWire(row: PullRow): unknown {
  const body = JSON.parse(fromBase64(row.payload)) as Record<string, unknown>;
  return { ...body, opVersion: row.opVersion, hlc: row.hlc, deviceId: row.deviceId };
}

/** Reads a non-2xx response's body for the specific reason, so the status bar says more than a number. */
async function classifyErrorResponse(response: Response): Promise<SyncError> {
  if (response.status === 401) {
    return new SyncError('unauthorized', 'Your session has expired. Sign in again to keep syncing.');
  }
  if (response.status >= 500) {
    return new SyncError('server', `The server is having trouble (status ${String(response.status)}).`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return new SyncError('malformed', `Request failed with status ${String(response.status)} and no readable error.`);
  }
  const error = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).error : undefined;
  const message = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).message : undefined;
  if (error === 'clock-skew') {
    return new SyncError('clock-skew', typeof message === 'string' ? message : "This device's clock looks wrong.");
  }
  return new SyncError(
    'rejected',
    typeof error === 'string' ? error : `Request rejected with status ${String(response.status)}.`,
  );
}

/** Every network call funnels through here so `fetch` throwing and a non-2xx response are classified alike (#106). */
async function request(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new SyncError('offline', 'No network connection.');
  }
  if (!response.ok) throw await classifyErrorResponse(response);
  return response;
}

async function postOps(ops: readonly OpWire[]): Promise<void> {
  await request('/api/ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops }),
  });
}

async function getOps(since: number): Promise<readonly PullRow[]> {
  const response = await request(`/api/ops?since=${String(since)}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SyncError('malformed', 'The server response could not be read.');
  }
  const ops = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).ops : undefined;
  if (!Array.isArray(ops)) throw new SyncError('malformed', 'The server response was missing its operations.');
  return ops as readonly PullRow[];
}

/**
 * A one-off push outside any engine's cursor — used only by adoption (#109) to send a
 * device's entire anonymous log to the server under the new session's cookie, before the
 * per-account store and its own engine exist yet.
 */
export async function pushRecords(records: readonly OpRecord[]): Promise<void> {
  for (let start = 0; start < records.length; start += MAX_PAGE_SIZE) {
    await postOps(records.slice(start, start + MAX_PAGE_SIZE).map(toWire));
  }
}

export async function createSyncEngine(options: SyncEngineOptions): Promise<SyncEngine> {
  const { store, onUnauthorized } = options;
  // Read once at creation, same shape as `openStore` reading state off disk. Reassigned as
  // pushing/pulling makes progress; never read back from the store mid-run, so a run's own
  // progress is always self-consistent even if something else changed `store` underneath it
  // (nothing does today, but `receive` and `mutate` share no state with this cursor).
  let cursor: SyncCursor = await store.getSyncCursor();
  let status: SyncState = { kind: 'syncing' };
  // Kept across failing runs so the status shows how long it has been failing, not how long
  // since the last attempt — `describeStatus` (ui/status.ts) escalates on that duration.
  let failingSince: number | undefined;
  // Drives the backoff below (#106); reset to 0 on any successful run.
  let consecutiveFailures = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  // `onUnauthorized` fires once per failure episode, not once per retry — otherwise a caller
  // reacting to it (e.g. re-checking identity) would be invoked on every backoff tick.
  let unauthorizedNotified = false;
  const listeners = new Set<() => void>();
  let closed = false;
  let running = false;
  // `trigger()` can set this while `runSync()` below is mid-`await` on `pull`/`push` — that
  // is the actual mechanism by which a concurrent trigger causes the current run to loop
  // again rather than starting a second, overlapping one. TypeScript's control-flow analysis
  // can't see that concurrent write, so it narrows a closed-over boolean (even one behind an
  // object holder) to whatever this function last assigned it; reading it back through a
  // function with its own declared return type sidesteps that narrowing.
  let rerunRequested = false;
  function requestRerun(): void {
    rerunRequested = true;
  }
  function consumeRerunRequest(): boolean {
    return rerunRequested;
  }
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function setStatus(next: SyncState): void {
    status = next;
    for (const listener of listeners) listener();
  }

  function clearScheduledRetry(): void {
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  }

  /**
   * Exponential backoff with jitter (#106): doubles from `BASE_RETRY_MS` per consecutive
   * failure, capped at `MAX_RETRY_MS`, and randomised to 50-100% of that so many tabs failing
   * against the same flaky link don't all retry in lockstep. This runs *alongside* the
   * regular `online` listener and 30s poll below, as a fallback for the cases neither
   * covers — `navigator.onLine` firing late, or a failure that isn't about connectivity at
   * all (a rejected batch, a server error).
   */
  function scheduleRetry(): void {
    clearScheduledRetry();
    const backoff = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** (consecutiveFailures - 1));
    const jittered = backoff * (0.5 + Math.random() * 0.5);
    retryTimer = setTimeout(trigger, jittered);
  }

  async function pull(): Promise<void> {
    for (;;) {
      const rows = await getOps(cursor.pulled ?? 0);
      if (rows.length === 0) return;
      await store.receive(rows.map(fromWire));
      // Persisted only once `receive` has resolved — itself durable-before-return — so a
      // crash here just re-pulls the same page next time, which `receive`'s HLC dedupe makes
      // a harmless no-op rather than a duplicate.
      const lastRow = rows[rows.length - 1];
      if (lastRow === undefined) return;
      cursor = { ...cursor, pulled: lastRow.seq };
      await store.setSyncCursor(cursor);
      if (rows.length < MAX_PAGE_SIZE) return;
    }
  }

  async function push(): Promise<void> {
    for (;;) {
      const outgoing = store.outgoing(cursor.pushed);
      if (outgoing.length === 0) return;
      const chunk = outgoing.slice(0, MAX_PAGE_SIZE).map(toWire);
      await postOps(chunk);
      // The chunk's own last record, not `store.head()`: a local edit could land mid-push and
      // move the head past what this chunk actually sent.
      const lastWire = chunk[chunk.length - 1];
      if (lastWire === undefined) return;
      cursor = { ...cursor, pushed: lastWire.hlc };
      await store.setSyncCursor(cursor);
      if (chunk.length < MAX_PAGE_SIZE) return;
    }
  }

  async function runSync(): Promise<void> {
    running = true;
    try {
      do {
        rerunRequested = false;
        await pull();
        await push();
      } while (consumeRerunRequest() && !closed);
      if (!closed) {
        failingSince = undefined;
        consecutiveFailures = 0;
        unauthorizedNotified = false;
        clearScheduledRetry();
        const stillPending = store.outgoing(cursor.pushed).length > 0;
        setStatus(stillPending ? { kind: 'syncing' } : { kind: 'synced', at: Date.now() });
      }
    } catch (error) {
      if (!closed) {
        failingSince ??= Date.now();
        consecutiveFailures += 1;
        setStatus({
          kind: 'failing',
          since: failingSince,
          message: error instanceof Error ? error.message : String(error),
        });
        // Retrying an unauthorized request is pointless until something re-establishes the
        // session — surfaced once per episode so a caller (session-context) can react, e.g. by
        // re-checking identity, without being called again on every backoff tick below.
        if (error instanceof SyncError && error.kind === 'unauthorized' && !unauthorizedNotified) {
          unauthorizedNotified = true;
          onUnauthorized?.();
        }
        scheduleRetry();
      }
    } finally {
      running = false;
    }
  }

  function trigger(): void {
    if (closed) return;
    if (running) {
      // A run is already in flight: rather than starting a second, overlapping one, ask
      // the current run to go again once it finishes.
      requestRerun();
      return;
    }
    void runSync();
  }

  function debouncedTrigger(): void {
    if (debounceTimer !== undefined) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(trigger, PUSH_DEBOUNCE_MS);
  }

  const unsubscribeStore = store.subscribe(debouncedTrigger);
  const interval = setInterval(trigger, POLL_INTERVAL_MS);
  window.addEventListener('online', trigger);

  trigger();

  return {
    get status() {
      return status;
    },
    pending: () => store.outgoing(cursor.pushed).length,
    subscribe(listener) {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
    close() {
      closed = true;
      if (debounceTimer !== undefined) clearTimeout(debounceTimer);
      clearScheduledRetry();
      clearInterval(interval);
      window.removeEventListener('online', trigger);
      unsubscribeStore();
      listeners.clear();
    },
  };
}
