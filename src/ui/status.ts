/**
 * What the status line says, and why (#101).
 *
 * One rule decides everything here: the user must always be able to tell whether their data
 * exists anywhere but this device. The failure this guards against is not a missing badge —
 * it is a reassuring one. A sync that has been failing since breakfast must not look like a
 * sync that succeeded a minute ago, and a device holding the only copy of a birth record
 * must say so rather than show a tick.
 *
 * Two things it deliberately does *not* say:
 *
 * - "Offline" to a user who is not signed in. For them offline is the normal mode, not a
 *   degraded one — everything works, nothing is pending, and there is no server to be
 *   disconnected from. Announcing it would invent a problem.
 * - "Synced" while any local change is unacknowledged. A tick that means "some of your
 *   data reached the server" is worse than no tick.
 *
 * Sync itself arrives in M8. Its states are modelled now so the indicator does not have to
 * be redesigned around them later; until then the store reports `off`.
 */
import type { Persistence } from '../store/persist.js';

export type SyncState =
  /** Not signed in. The local store is the whole system, and that is a supported way to run. */
  | { readonly kind: 'off' }
  | { readonly kind: 'syncing' }
  | { readonly kind: 'synced'; readonly at: number }
  | { readonly kind: 'failing'; readonly since: number; readonly message: string };

export interface StatusInput {
  readonly online: boolean;
  readonly persistence: Persistence;
  /** Local operations no server has acknowledged. Every operation, when sync is off. */
  readonly pending: number;
  readonly sync: SyncState;
  readonly now: number;
}

/** `warn` is for something the user should act on, not for something merely unusual. */
export type Tone = 'ok' | 'note' | 'warn';

export interface Status {
  readonly tone: Tone;
  /** A few words, short enough for a bar. */
  readonly label: string;
  /** One sentence saying what it means, and what to do if anything. */
  readonly detail: string;
  readonly action?: { readonly href: string; readonly text: string };
}

/**
 * How long a failing sync may go unnoticed before it is loud.
 *
 * Ten minutes, because a laptop lid or a train tunnel produces failures lasting seconds and
 * escalating those would train the user to ignore the indicator — which is the only way this
 * component can actually fail at its job.
 */
const LOUD_AFTER_MS = 10 * 60_000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "7 minutes ago" — vague where precision would be false. */
export function ago(now: number, then: number): string {
  const elapsed = now - then;
  // A clock that moved backwards, or a timestamp from a peer whose clock is ahead. Rounding
  // it to "just now" is honest; "in 3 minutes" would read as a bug in the sync, not the clock.
  if (elapsed < 45_000) return 'just now';
  if (elapsed < HOUR) return `${String(Math.round(elapsed / MINUTE))} minutes ago`;
  if (elapsed < 2 * HOUR) return 'an hour ago';
  if (elapsed < DAY) return `${String(Math.floor(elapsed / HOUR))} hours ago`;
  if (elapsed < 2 * DAY) return 'yesterday';
  return `${String(Math.floor(elapsed / DAY))} days ago`;
}

function changes(pending: number): string {
  return pending === 1 ? '1 change' : `${String(pending)} changes`;
}

export function describeStatus(input: StatusInput): Status {
  const { sync, persistence, pending, online, now } = input;

  if (sync.kind === 'failing') {
    // Escalates with age rather than on the first failure, and always says the data is still
    // here: the user's worry on seeing this is "have I lost anything", and the answer is no.
    const stale = now - sync.since >= LOUD_AFTER_MS;
    return {
      tone: stale ? 'warn' : 'note',
      label: stale ? 'Sync failing' : 'Sync retrying',
      detail: `Syncing has been failing since ${ago(now, sync.since)}. Nothing has been lost — every change is saved on this device and will be sent when syncing recovers. ${sync.message}`,
      action: { href: '#/about', text: 'Export a copy' },
    };
  }

  if (sync.kind === 'off') {
    const evictable = persistence.state !== 'persisted';
    return {
      tone: evictable ? 'warn' : 'note',
      label: 'Local only',
      detail: evictable
        ? // The honest version of "your data is safe": it is here, and the browser is
          // entitled to delete it. Naming the remedy matters more than naming the risk.
          'This device holds the only copy of your data, and the browser has not promised to keep it. Export a copy, or sign in to sync.'
        : 'This device holds the only copy of your data. The browser has agreed to keep it, but a lost device is a lost copy — export a copy, or sign in to sync.',
      action: { href: '#/about', text: 'How to keep a copy' },
    };
  }

  if (sync.kind === 'syncing') {
    return { tone: 'ok', label: 'Syncing…', detail: `Sending ${changes(pending)} to your server.` };
  }

  if (!online) {
    return {
      tone: 'note',
      label: pending === 0 ? 'Offline' : `Offline — ${changes(pending)} waiting`,
      detail:
        pending === 0
          ? 'No network. Everything works offline; nothing is waiting to be sent.'
          : `No network. ${changes(pending)} are saved on this device and will be sent when you are back online.`,
    };
  }

  if (pending > 0) {
    // Online, not syncing, and something is unsent. Not an error yet — the engine batches —
    // but it is not "synced" either, and claiming it would be the lie this file exists to
    // prevent.
    return { tone: 'note', label: `${changes(pending)} to send`, detail: 'Waiting to sync.' };
  }

  return { tone: 'ok', label: 'Synced', detail: `Everything reached your server ${ago(now, sync.at)}.` };
}
