// @vitest-environment jsdom
/**
 * `session-context.tsx` against a real `build()` server (same style as
 * `test/sync-engine.test.ts`) and real `openStore()` stores (`fake-indexeddb`,
 * installed globally by `test/setup.ts`) — the adoption prompt's
 * cross-account-bleed guard (#109) and the offline-boot fallback are wiring
 * between real modules, not something a mock of either side could prove.
 *
 * A `Probe` component records the hook's latest value into a module-level
 * variable on every render, read back after `vi.waitFor` settles — simpler
 * than driving `AccountPanel`'s form fields through synthetic DOM events for
 * logic that lives in `session-context.tsx`, not in the form.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { build } from '../server/index.ts';
import { hashPassword } from '../server/auth/passwords.ts';
import { openStore } from '../src/store/store.ts';
import { SessionProvider, useSession, useStoreStatus, useSyncEngine } from '../src/ui/session-context.js';
import { OIDC_CALLBACK_PATH } from '../src/ui/oidc-pkce.js';
import { startFakeAuthentik, type FakeAuthentik } from './fake-authentik.ts';
import type { AdoptionPrompt, StoreStatus } from '../src/ui/session-context.js';
import type { AuthUser } from '../src/sync/auth-client.js';
import type { SyncEngine } from '../src/sync/engine.js';

const BOOTSTRAP_TOKEN = 'test-bootstrap-token';
const WAIT = { timeout: 5000 };
const LAST_USER_KEY = 'astraya:lastUserId';

process.env.LOG_LEVEL = 'silent';

let dir: string;
let dbPath: string;
let app: FastifyInstance;
let baseUrl: string;
const realFetch = globalThis.fetch;

interface ProbeApi {
  readonly status: StoreStatus;
  readonly engine: SyncEngine | undefined;
  readonly user: AuthUser | undefined;
  readonly adoption: AdoptionPrompt | undefined;
  readonly signIn: (username: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly resolveAdoption: (accept: boolean) => Promise<void>;
}

let latest: ProbeApi | undefined;

function Probe(): null {
  const status = useStoreStatus();
  const engine = useSyncEngine();
  const session = useSession();
  latest = { status, engine, ...session };
  return null;
}

function mount(): { container: HTMLElement; root: Root } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      <SessionProvider>
        <Probe />
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
  latest = undefined;
}

/** A persistent cookie jar for the whole test, matching a single browser tab's single origin. */
function installFetch(): void {
  let cookie: string | undefined;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), baseUrl);
    const headers = new Headers(init?.headers);
    if (cookie !== undefined) headers.set('cookie', cookie);
    const response = await realFetch(url, { ...init, headers });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie !== null) cookie = setCookie.split(';')[0];
    return response;
  };
}

async function deleteAllDatabases(): Promise<void> {
  const databases = await indexedDB.databases();
  await Promise.all(
    databases.map(async (info) => {
      const name = info.name;
      if (name === undefined) return;
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => {
          resolve();
        };
        request.onerror = () => {
          reject(request.error ?? new Error(`deleteDatabase(${name}) failed`));
        };
        request.onblocked = () => {
          resolve();
        };
      });
    }),
  );
}

/** Bypasses `/api/setup`'s one-admin-only rule, for a second account in the bleed-guard test. */
async function insertUser(username: string, password: string): Promise<string> {
  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  const raw = new DatabaseSync(dbPath);
  raw
    .prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, 0, ?)')
    .run(id, username, passwordHash, new Date().toISOString());
  raw.close();
  return id;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-session-context-test-'));
  dbPath = join(dir, 'astraya.db');
  process.env.ASTRAYA_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
  process.env.ASTRAYA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  app = await build({ dbPath });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind to a port');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
  await realFetch(new URL('/api/setup', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: BOOTSTRAP_TOKEN, username: 'alice', password: 'correct-horse-battery' }),
  });
  installFetch();
  localStorage.clear();
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  await app.close();
  await deleteAllDatabases();
  delete process.env.ASTRAYA_BOOTSTRAP_TOKEN;
  delete process.env.ASTRAYA_ENCRYPTION_KEY;
  rmSync(dir, { recursive: true, force: true });
  localStorage.clear();
});

describe('signed out', () => {
  it('opens the anonymous store with no account and no sync engine', async () => {
    const { container, root } = mount();
    try {
      await vi.waitFor(() => {
        expect(latest?.status.kind).toBe('ready');
      }, WAIT);
      expect(latest?.user).toBeUndefined();
      expect(latest?.engine).toBeUndefined();
      expect(latest?.adoption).toBeUndefined();
    } finally {
      unmount(root, container);
    }
  });
});

describe('signing in with no local data', () => {
  it('switches to the account store directly, with no adoption prompt', async () => {
    const { container, root } = mount();
    try {
      await vi.waitFor(() => {
        expect(latest?.status.kind).toBe('ready');
      }, WAIT);

      await act(async () => {
        await latest?.signIn('alice', 'correct-horse-battery');
      });

      expect(latest?.adoption).toBeUndefined();
      await vi.waitFor(() => {
        expect(latest?.user?.username).toBe('alice');
      }, WAIT);
    } finally {
      unmount(root, container);
    }
  });
});

describe('adoption on sign-in with existing local data (#109)', () => {
  it('prompts, and adopts the anonymous log into the account on accept', async () => {
    const anonymous = await openStore();
    await anonymous.mutate([{ entity: 'person', entityId: 'p1', field: 'displayName', value: 'Ada' }]);
    anonymous.close();

    const { container, root } = mount();
    try {
      await vi.waitFor(() => {
        expect(latest?.status.kind).toBe('ready');
      }, WAIT);

      await act(async () => {
        await latest?.signIn('alice', 'correct-horse-battery');
      });

      await vi.waitFor(() => {
        expect(latest?.adoption?.recordCount).toBe(1);
      }, WAIT);
      // Not switched yet — the prompt is shown over the still-anonymous data.
      expect(latest?.user).toBeUndefined();

      await act(async () => {
        await latest?.resolveAdoption(true);
      });

      await vi.waitFor(() => {
        expect(latest?.user?.username).toBe('alice');
      }, WAIT);
      expect(latest?.adoption).toBeUndefined();
      expect(latest?.status.kind === 'ready' && latest.status.store.state.people.get('p1')?.displayName).toBe('Ada');

      const reopenedAnonymous = await openStore();
      const decision = await reopenedAnonymous.getAdoptionDecision();
      reopenedAnonymous.close();
      expect(decision).toBe(`user:${String(latest?.user?.id)}`);
    } finally {
      unmount(root, container);
    }
  });

  it('leaves the data on this device on decline, and never prompts again', async () => {
    const anonymous = await openStore();
    await anonymous.mutate([{ entity: 'person', entityId: 'p1', field: 'displayName', value: 'Ada' }]);
    anonymous.close();

    const { container, root } = mount();
    try {
      await vi.waitFor(() => {
        expect(latest?.status.kind).toBe('ready');
      }, WAIT);

      await act(async () => {
        await latest?.signIn('alice', 'correct-horse-battery');
      });
      await vi.waitFor(() => {
        expect(latest?.adoption?.recordCount).toBe(1);
      }, WAIT);

      await act(async () => {
        await latest?.resolveAdoption(false);
      });

      await vi.waitFor(() => {
        expect(latest?.user?.username).toBe('alice');
      }, WAIT);
      expect(latest?.status.kind === 'ready' && latest.status.store.state.people.get('p1')).toBeUndefined();

      const reopenedAnonymous = await openStore();
      const decision = await reopenedAnonymous.getAdoptionDecision();
      reopenedAnonymous.close();
      expect(decision).toBe('declined');
    } finally {
      unmount(root, container);
    }
  });
});

describe('the cross-account-bleed guard', () => {
  it('does not offer a second account the first account’s already-claimed data', async () => {
    const anonymous = await openStore();
    await anonymous.mutate([{ entity: 'person', entityId: 'p1', field: 'displayName', value: 'Ada' }]);
    anonymous.close();
    const bobId = await insertUser('bob', 'correct-horse-battery-2');

    const { container, root } = mount();
    try {
      await vi.waitFor(() => {
        expect(latest?.status.kind).toBe('ready');
      }, WAIT);

      await act(async () => {
        await latest?.signIn('alice', 'correct-horse-battery');
      });
      await vi.waitFor(() => {
        expect(latest?.adoption?.recordCount).toBe(1);
      }, WAIT);
      await act(async () => {
        await latest?.resolveAdoption(true);
      });
      await vi.waitFor(() => {
        expect(latest?.user?.username).toBe('alice');
      }, WAIT);

      await act(async () => {
        await latest?.signOut();
      });
      await vi.waitFor(() => {
        expect(latest?.user).toBeUndefined();
      }, WAIT);

      await act(async () => {
        await latest?.signIn('bob', 'correct-horse-battery-2');
      });

      // Already decided (claimed by alice) — bob is never prompted and never sees it.
      expect(latest?.adoption).toBeUndefined();
      await vi.waitFor(() => {
        expect(latest?.user?.id).toBe(bobId);
      }, WAIT);
      expect(latest?.status.kind === 'ready' && latest.status.store.state.people.get('p1')).toBeUndefined();
    } finally {
      unmount(root, container);
    }
  });
});

describe('a rejected session during sync (#106)', () => {
  it('forgets the account locally without touching its store, so signing back in resumes it', async () => {
    const { container, root } = mount();
    try {
      await vi.waitFor(() => {
        expect(latest?.status.kind).toBe('ready');
      }, WAIT);
      await act(async () => {
        await latest?.signIn('alice', 'correct-horse-battery');
      });
      await vi.waitFor(() => {
        expect(latest?.user?.username).toBe('alice');
      }, WAIT);
      const accountStore = latest?.status.kind === 'ready' ? latest.status.store : undefined;
      expect(accountStore).toBeDefined();

      // A write lands in the still-open per-account store before the session dies.
      await act(async () => {
        await accountStore?.mutate([{ entity: 'person', entityId: 'p1', field: 'displayName', value: 'Ada' }]);
      });

      // The server no longer honours this device's session — every subsequent request the
      // engine makes comes back 401, as if the session had expired mid-sync.
      globalThis.fetch = () => Promise.resolve(new Response(null, { status: 401 }));

      await vi.waitFor(() => {
        expect(latest?.user).toBeUndefined();
      }, WAIT);
      expect(latest?.engine).toBeUndefined();
      // Still the same store, with the write intact — not reset to a fresh anonymous one.
      expect(latest?.status.kind === 'ready' && latest.status.store.state.people.get('p1')?.displayName).toBe('Ada');

      // Signing back in as the same account reopens that same database rather than an empty one.
      installFetch();
      await act(async () => {
        await latest?.signIn('alice', 'correct-horse-battery');
      });
      await vi.waitFor(() => {
        expect(latest?.user?.username).toBe('alice');
      }, WAIT);
      expect(latest?.adoption).toBeUndefined();
      expect(latest?.status.kind === 'ready' && latest.status.store.state.people.get('p1')?.displayName).toBe('Ada');
    } finally {
      unmount(root, container);
    }
  });
});

describe('offline at boot', () => {
  it('falls back to the cached last-known account instead of the anonymous store', async () => {
    const account = await openStore({ name: 'astraya-user-user-xyz' });
    await account.mutate([{ entity: 'person', entityId: 'p1', field: 'displayName', value: 'Cached' }]);
    account.close();
    localStorage.setItem(LAST_USER_KEY, 'user-xyz');
    globalThis.fetch = () => Promise.reject(new Error('network unreachable'));

    const { container, root } = mount();
    try {
      await vi.waitFor(() => {
        expect(latest?.status.kind).toBe('ready');
      }, WAIT);
      expect(latest?.status.kind === 'ready' && latest.status.store.state.people.get('p1')?.displayName).toBe('Cached');
      expect(latest?.engine).toBeUndefined();
    } finally {
      unmount(root, container);
    }
  });

  it('falls back to the anonymous store when there is no cached account', async () => {
    globalThis.fetch = () => Promise.reject(new Error('network unreachable'));

    const { container, root } = mount();
    try {
      await vi.waitFor(() => {
        expect(latest?.status.kind).toBe('ready');
      }, WAIT);
      expect(latest?.user).toBeUndefined();
      expect(latest?.engine).toBeUndefined();
    } finally {
      unmount(root, container);
    }
  });
});

describe('the OIDC callback path (#75)', () => {
  const CLIENT_ID = 'astraya-test-client';
  let fakeAuthentik: FakeAuthentik;

  // Rebuilds `app` with OIDC configured, on the same on-disk db the outer
  // `beforeEach` already ran `/api/setup` against — so 'alice' is a real local
  // account throughout, letting these tests also prove a JIT-provisioned OIDC
  // identity is a distinct account from it.
  beforeEach(async () => {
    await app.close();
    fakeAuthentik = await startFakeAuthentik(CLIENT_ID);
    process.env.ASTRAYA_OIDC_ISSUER = fakeAuthentik.baseUrl;
    process.env.ASTRAYA_OIDC_CLIENT_ID = CLIENT_ID;
    process.env.ASTRAYA_PUBLIC_URL = 'http://localhost:8080';
    app = await build({ dbPath });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('server did not bind to a port');
    baseUrl = `http://127.0.0.1:${String(address.port)}`;
    installFetch();
  });

  afterEach(async () => {
    await fakeAuthentik.close();
    delete process.env.ASTRAYA_OIDC_ISSUER;
    delete process.env.ASTRAYA_OIDC_CLIENT_ID;
    delete process.env.ASTRAYA_PUBLIC_URL;
  });

  /** Stashes the pending PKCE state `oidc-pkce.ts` expects, and navigates (without a real
   * page load — jsdom has no navigation) to the callback path with a matching `code`/`state`. */
  function arriveAtCallback(code: string, state: string, pendingState: string, nonce: string): void {
    sessionStorage.setItem(
      'astraya:oidcPending',
      JSON.stringify({ state: pendingState, codeVerifier: 'verifier-1', nonce }),
    );
    window.history.pushState(null, '', `${OIDC_CALLBACK_PATH}?code=${code}&state=${state}`);
  }

  it('drives switchTo the same way password sign-in does, including the adoption prompt', async () => {
    const anonymous = await openStore();
    await anonymous.mutate([{ entity: 'person', entityId: 'p1', field: 'displayName', value: 'Ada' }]);
    anonymous.close();

    const idToken = await fakeAuthentik.mintIdToken({
      sub: 'authentik-subject-1',
      nonce: 'nonce-1',
      preferred_username: 'carol',
    });
    fakeAuthentik.registerCode('code-1', { idToken });
    arriveAtCallback('code-1', 'state-1', 'state-1', 'nonce-1');

    const { container, root } = mount();
    try {
      await vi.waitFor(() => {
        expect(latest?.adoption?.recordCount).toBe(1);
      }, WAIT);
      // Not switched yet — same as a password sign-in, the prompt is shown over the
      // still-anonymous data.
      expect(latest?.user).toBeUndefined();
      // The one-time code is out of the URL/history regardless of outcome, so a reload
      // can never resubmit it.
      expect(window.location.pathname).toBe('/');

      await act(async () => {
        await latest?.resolveAdoption(true);
      });

      await vi.waitFor(() => {
        expect(latest?.user?.username).toBe('carol');
      }, WAIT);
      expect(latest?.status.kind === 'ready' && latest.status.store.state.people.get('p1')?.displayName).toBe('Ada');
    } finally {
      unmount(root, container);
    }
  });

  it('rejects a PKCE state mismatch client-side, with no network call and a normal signed-out boot', async () => {
    const idToken = await fakeAuthentik.mintIdToken({
      sub: 'authentik-subject-2',
      nonce: 'nonce-2',
      preferred_username: 'dave',
    });
    fakeAuthentik.registerCode('code-2', { idToken });
    // The `state` on the URL does not match what was stashed before the redirect —
    // e.g. a forged or stale callback URL.
    arriveAtCallback('code-2', 'attacker-state', 'real-state', 'nonce-2');

    const calls: string[] = [];
    const wrapped = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      calls.push(input instanceof Request ? input.url : String(input));
      return wrapped(input, init);
    };

    const { container, root } = mount();
    try {
      await vi.waitFor(() => {
        expect(latest?.status.kind).toBe('ready');
      }, WAIT);
      expect(latest?.user).toBeUndefined();
      expect(latest?.adoption).toBeUndefined();
      expect(calls.some((url) => url.includes('/api/auth/oidc/callback'))).toBe(false);
      expect(window.location.pathname).toBe('/');
    } finally {
      unmount(root, container);
    }
  });
});
