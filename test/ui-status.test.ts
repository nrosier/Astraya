/**
 * Tests for the status line (#101).
 *
 * The dangerous failure of a status indicator is a reassuring one, so most of these assert
 * what it must *not* say: no tick while anything is unsent, no "offline" warning at a user
 * who has no server to be offline from, and no calm wording on a sync that has been failing
 * for an hour.
 */
import { describe, expect, it } from 'vitest';
import { ago, describeStatus, type StatusInput, type SyncState } from '../src/ui/status.js';
import type { Persistence } from '../src/store/persist.js';

const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);
const MINUTE = 60_000;

const PERSISTED: Persistence = { state: 'persisted' };
const EVICTABLE: Persistence = { state: 'evictable' };

function status(overrides: Partial<StatusInput> = {}): ReturnType<typeof describeStatus> {
  const sync: SyncState = { kind: 'synced', at: NOW - MINUTE };
  return describeStatus({ online: true, persistence: PERSISTED, pending: 0, sync, now: NOW, ...overrides });
}

describe('signed out', () => {
  it('says the device holds the only copy', () => {
    const shown = status({ sync: { kind: 'off' } });
    expect(shown.label).toBe('Local only');
    expect(shown.detail).toContain('only copy');
    expect(shown.action?.href).toBe('#/about');
  });

  it('warns when the browser has not promised to keep the data', () => {
    // Persisted is a real promise; evictable means the browser may delete the only copy of a
    // birth record under storage pressure, which the user can only defend against by
    // exporting. So the difference has to be visible, not just recorded.
    expect(status({ sync: { kind: 'off' }, persistence: EVICTABLE }).tone).toBe('warn');
    expect(status({ sync: { kind: 'off' }, persistence: PERSISTED }).tone).toBe('note');
    expect(status({ sync: { kind: 'off' }, persistence: EVICTABLE }).detail).toContain('Export');
  });

  it('does not report being offline to a user with no server', () => {
    // Offline is the normal mode for a local-only user: everything works, nothing is
    // pending, and there is nothing to be disconnected from. Saying "offline" would invent
    // a problem and teach them to ignore the indicator.
    const shown = status({ sync: { kind: 'off' }, online: false, pending: 12 });
    expect(shown.label).toBe('Local only');
    expect(shown.detail).not.toContain('network');
  });

  it('mentions signing in, since syncing is the fix and it is optional', () => {
    expect(status({ sync: { kind: 'off' } }).detail).toContain('sign in');
  });
});

describe('synced', () => {
  it('says when, not just that', () => {
    const shown = status({ sync: { kind: 'synced', at: NOW - 7 * MINUTE } });
    expect(shown.label).toBe('Synced');
    expect(shown.tone).toBe('ok');
    expect(shown.detail).toContain('7 minutes ago');
  });

  it('never claims to be synced while a change is unsent', () => {
    // A tick meaning "some of your data reached the server" is worse than no tick at all.
    const shown = status({ sync: { kind: 'synced', at: NOW - MINUTE }, pending: 3 });
    expect(shown.label).not.toContain('Synced');
    expect(shown.label).toContain('3 changes');
  });

  it('counts one change in the singular', () => {
    expect(status({ pending: 1 }).label).toContain('1 change');
    expect(status({ pending: 1 }).label).not.toContain('1 changes');
  });
});

describe('offline while signed in', () => {
  it('says what is waiting', () => {
    const shown = status({ online: false, pending: 2 });
    expect(shown.label).toContain('Offline');
    expect(shown.label).toContain('2 changes');
    expect(shown.detail).toContain('sent when you are back online');
  });

  it('does not imply something is stuck when nothing is', () => {
    const shown = status({ online: false, pending: 0 });
    expect(shown.label).toBe('Offline');
    expect(shown.tone).toBe('note');
    expect(shown.detail).toContain('nothing is waiting');
  });
});

describe('failing sync', () => {
  it('stays quiet about a failure seconds old', () => {
    // A lid closing or a tunnel produces failures lasting seconds. Escalating those would
    // train the user to ignore the indicator, which is the only way it can really fail.
    const sync: SyncState = { kind: 'failing', since: NOW - 30_000, message: 'Network error.' };
    const shown = status({ sync });
    expect(shown.tone).toBe('note');
    expect(shown.label).toBe('Sync retrying');
  });

  it('escalates once it has been failing for a while', () => {
    const sync: SyncState = { kind: 'failing', since: NOW - 90 * MINUTE, message: 'Network error.' };
    const shown = status({ sync });
    expect(shown.tone).toBe('warn');
    expect(shown.label).toBe('Sync failing');
    expect(shown.detail).toContain('an hour ago');
  });

  it('says nothing has been lost, and carries the reason', () => {
    // The user's question on seeing this is "have I lost anything", and the answer is no.
    // The underlying message is included because "sync failed" alone is unactionable.
    const sync: SyncState = { kind: 'failing', since: NOW - 20 * MINUTE, message: 'Certificate expired.' };
    const shown = status({ sync });
    expect(shown.detail).toContain('Nothing has been lost');
    expect(shown.detail).toContain('Certificate expired.');
  });
});

describe('elapsed time', () => {
  it('rounds the recent past to just now', () => {
    expect(ago(NOW, NOW - 1000)).toBe('just now');
    expect(ago(NOW, NOW - 44_000)).toBe('just now');
  });

  it('reads a clock that ran backwards as just now rather than as the future', () => {
    // A peer's timestamp can be ahead of ours, and a device clock can be corrected while the
    // app is open. "in 3 minutes" would read as a bug in the sync rather than in the clock.
    expect(ago(NOW, NOW + 3 * MINUTE)).toBe('just now');
  });

  it('scales through minutes, hours and days', () => {
    expect(ago(NOW, NOW - 7 * MINUTE)).toBe('7 minutes ago');
    expect(ago(NOW, NOW - 59 * MINUTE)).toBe('59 minutes ago');
    expect(ago(NOW, NOW - 75 * MINUTE)).toBe('an hour ago');
    expect(ago(NOW, NOW - 5 * 60 * MINUTE)).toBe('5 hours ago');
    expect(ago(NOW, NOW - 30 * 60 * MINUTE)).toBe('yesterday');
    expect(ago(NOW, NOW - 4 * 24 * 60 * MINUTE)).toBe('4 days ago');
  });
});
