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

async function postOps(ops: readonly OpWire[]): Promise<void> {
  const response = await fetch('/api/ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops }),
  });
  if (!response.ok) throw new Error(`Push failed with status ${String(response.status)}.`);
}

async function getOps(since: number): Promise<readonly PullRow[]> {
  const response = await fetch(`/api/ops?since=${String(since)}`);
  if (!response.ok) throw new Error(`Pull failed with status ${String(response.status)}.`);
  const body = (await response.json()) as { ops: readonly PullRow[] };
  return body.ops;
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
  const { store } = options;
  // Read once at creation, same shape as `openStore` reading state off disk. Reassigned as
  // pushing/pulling makes progress; never read back from the store mid-run, so a run's own
  // progress is always self-consistent even if something else changed `store` underneath it
  // (nothing does today, but `receive` and `mutate` share no state with this cursor).
  let cursor: SyncCursor = await store.getSyncCursor();
  let status: SyncState = { kind: 'syncing' };
  // Kept across failing runs so the status shows how long it has been failing, not how long
  // since the last attempt — `describeStatus` (ui/status.ts) escalates on that duration.
  let failingSince: number | undefined;
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
        const stillPending = store.outgoing(cursor.pushed).length > 0;
        setStatus(stillPending ? { kind: 'syncing' } : { kind: 'synced', at: Date.now() });
      }
    } catch (error) {
      if (!closed) {
        failingSince ??= Date.now();
        setStatus({
          kind: 'failing',
          since: failingSince,
          message: error instanceof Error ? error.message : String(error),
        });
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
      clearInterval(interval);
      window.removeEventListener('online', trigger);
      unsubscribeStore();
      listeners.clear();
    },
  };
}
