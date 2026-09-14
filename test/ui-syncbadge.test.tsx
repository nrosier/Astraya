// @vitest-environment jsdom
/**
 * Regression test for a real crash found by manually exercising the app in a
 * browser (not caught by any existing test): `useSyncState` used to return a
 * fresh `{ kind: 'off' }` object literal from `useSyncExternalStore`'s
 * `getSnapshot` on every call. With no sync engine — i.e. every signed-out
 * visitor — that breaks the snapshot's reference-stability contract and React
 * throws "Maximum update depth exceeded" (minified as error #185), leaving the
 * whole app blank.
 *
 * Mounted through `SessionProvider` alone, with no `StoreProvider`, against a
 * real `build()` server with no admin set up (`/api/auth/me` is 401) — this is
 * `SyncBadge`'s actual mounting context on most routes (#250: it now lives in
 * `App.tsx`'s global top bar, outside `Stored`, rather than inside it as the
 * old `StatusBar` did), so the signed-out, no-store, no-engine path is the one
 * actually exercised.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { build } from '../server/index.ts';
import { SessionProvider } from '../src/ui/session-context.js';
import { SyncBadge } from '../src/ui/SyncBadge.js';

const WAIT = { timeout: 5000 };

let dir: string;
let app: FastifyInstance;
let baseUrl: string;
const realFetch = globalThis.fetch;

function mount(): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <SessionProvider>
        <SyncBadge />
      </SessionProvider>,
    );
  });
  return { container, root };
}

function unmount(root: Root, container: HTMLElement): void {
  act(() => {
    root.unmount();
  });
  container.remove();
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-syncbadge-test-'));
  app = await build({ dbPath: join(dir, 'astraya.db') });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind to a port');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
  globalThis.fetch = async (input, init) =>
    realFetch(new URL(input instanceof Request ? input.url : String(input), baseUrl), init);
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('signed out, no store, no sync engine', () => {
  it('renders without React throwing "Maximum update depth exceeded"', async () => {
    const { container, root } = mount();
    try {
      await vi.waitFor(() => {
        expect(container.querySelector('.syncbadge')).not.toBeNull();
      }, WAIT);
      expect(container.querySelector('.syncbadge-label')?.textContent).toContain('Local only');
    } finally {
      unmount(root, container);
    }
  });
});
