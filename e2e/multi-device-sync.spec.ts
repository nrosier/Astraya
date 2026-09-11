/**
 * Two independent browser contexts against one real, built app and one real
 * server (#107) — proving what no unit test can: that the client's op-log
 * convergence (ADR 0002, `src/store/oplog.ts`'s LWW-by-HLC) and the relay's
 * blind pass-through (`server/ops/routes.ts`) actually converge two separate
 * devices, including through a real offline/online transition.
 *
 * All navigation after the very first `page.goto()` per device goes through
 * in-app links/buttons rather than `page.goto()`, deliberately: this is a
 * hash router, so every route change after the initial load is client-side
 * and must keep working with the context offline, exactly like a real device.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Locator, Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { build } from '../server/index.ts';

const BOOTSTRAP_TOKEN = 'e2e-bootstrap-token';
const USERNAME = 'alice';
const PASSWORD = 'correct-horse-battery-e2e';
const SYNCED_TIMEOUT = 20_000;

let dir: string;
let app: FastifyInstance;
let baseUrl: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-e2e-'));
  process.env.LOG_LEVEL = 'silent';
  process.env.ASTRAYA_BOOTSTRAP_TOKEN = BOOTSTRAP_TOKEN;
  process.env.ASTRAYA_ENCRYPTION_KEY = randomBytes(32).toString('base64');

  app = await build({ dbPath: join(dir, 'astraya.db') });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind to a port');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;

  const response = await fetch(new URL('/api/setup', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: BOOTSTRAP_TOKEN, username: USERNAME, password: PASSWORD }),
  });
  if (!response.ok) throw new Error(`bootstrap failed with status ${String(response.status)}`);
});

test.afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.ASTRAYA_BOOTSTRAP_TOKEN;
  delete process.env.ASTRAYA_ENCRYPTION_KEY;
});

interface Device {
  readonly context: BrowserContext;
  readonly page: Page;
}

async function newDevice(browser: Browser): Promise<Device> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

async function closeDevices(...devices: readonly Device[]): Promise<void> {
  await Promise.all(devices.map((device) => device.context.close()));
}

/**
 * `PersonForm` nests each field's inline error `<span>` inside its `<label>`, and validation
 * runs unconditionally — so a freshly-created, still-empty person has an invalid Name/Date/
 * Latitude/Longitude from the very first render, and the label's accessible text becomes
 * `"Name" + errorMessage` with no separating space. The "How the time is known" `<select>` has
 * the same shape for a different reason: its `<label>`'s accessible name includes every nested
 * `<option>`'s text, not just the selected one, so it is never exactly "How the time is known"
 * either. `getByLabel(label, { exact: true })` can't match either case. Scoping by the label's
 * own element (matched with a start-anchored regex, tolerant of the appended text) plus a
 * descendant selector sidesteps the accessible-name computation entirely, and — because the
 * anchor is on the label, not a substring — disambiguates from `AccountPanel`'s same-page
 * Username field (mounted alongside `PersonForm` on every `Stored` route) without an exact match.
 */
function labeledField(page: Page, label: RegExp, selector: string): Locator {
  return page.locator('label').filter({ hasText: label }).locator(selector);
}

/**
 * If this device holds local changes from before sign-in, `AccountPanel` swaps in the
 * adoption prompt (#109) instead of completing the switch — accept it, since these tests
 * want the pre-sign-in data to end up on the account.
 */
async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.getByText('Sign in to sync this device', { exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const adopt = page.getByRole('button', { name: 'Add it to my account', exact: true });
  const signedIn = page.getByText(`Signed in as ${username}`, { exact: true });
  await expect(adopt.or(signedIn)).toBeVisible();
  if (await adopt.isVisible()) {
    await adopt.click();
  }
  await expect(signedIn).toBeVisible();
}

async function waitSynced(page: Page): Promise<void> {
  await expect(page.getByText('Synced', { exact: true })).toBeVisible({ timeout: SYNCED_TIMEOUT });
}

/** Reopens the store and sync engine from scratch, so the next `waitSynced` proves a full pull. */
async function reloadAndWaitSynced(page: Page): Promise<void> {
  await page.reload();
  await waitSynced(page);
}

interface PersonInput {
  readonly name: string;
  readonly date: string;
  readonly time?: string;
  readonly latitude: string;
  readonly longitude: string;
}

/** Starting from the People list, creates a person and saves. Works offline — no network involved. */
async function createPerson(page: Page, input: PersonInput): Promise<void> {
  await page.getByRole('button', { name: 'Add a person', exact: true }).click();
  await labeledField(page, /^Name/, 'input[type="text"]').fill(input.name);
  await page.locator('input[type="date"]').fill(input.date);
  if (input.time !== undefined) {
    await labeledField(page, /^How the time is known/, 'select').selectOption('recorded');
    await page.locator('input[type="time"]').fill(input.time);
  }
  await labeledField(page, /^Latitude/, 'input[type="number"]').fill(input.latitude);
  await labeledField(page, /^Longitude/, 'input[type="number"]').fill(input.longitude);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved on this device.')).toBeVisible();
}

async function backToPeople(page: Page): Promise<void> {
  await page.locator('p.back a').click();
}

test.describe('multi-device offline sync (#107)', () => {
  test('two devices converge after concurrent offline edits to different fields', async ({ browser }) => {
    test.setTimeout(60_000);
    const a = await newDevice(browser);
    const b = await newDevice(browser);
    try {
      await a.page.goto(`${baseUrl}/#/people`);
      await createPerson(a.page, {
        name: 'Ada Lovelace',
        date: '1815-12-10',
        time: '07:45:00',
        latitude: '51.5072',
        longitude: '-0.1276',
      });
      await signIn(a.page, USERNAME, PASSWORD);
      await waitSynced(a.page);

      await b.page.goto(`${baseUrl}/#/people`);
      await signIn(b.page, USERNAME, PASSWORD);
      await waitSynced(b.page);
      await expect(b.page.getByRole('link', { name: /Ada Lovelace/ })).toBeVisible();
      await b.page.getByRole('link', { name: /Ada Lovelace/ }).click();

      await a.context.setOffline(true);
      await b.context.setOffline(true);

      // A edits the birth time while offline.
      await a.page.locator('input[type="time"]').fill('08:15:00');
      await a.page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(a.page.getByText('Saved on this device.')).toBeVisible();

      // B edits the notes on the same person, and creates a second person, while offline.
      await b.page.locator('textarea').fill('Mother of computing.');
      await b.page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(b.page.getByText('Saved on this device.')).toBeVisible();

      await backToPeople(b.page);
      await createPerson(b.page, {
        name: 'Grace Hopper',
        date: '1906-12-09',
        latitude: '41.7128',
        longitude: '-73.6',
      });

      await a.context.setOffline(false);
      await b.context.setOffline(false);
      await reloadAndWaitSynced(a.page);
      await reloadAndWaitSynced(b.page);

      // Both devices converge on Ada's edited time and Grace's addition.
      await backToPeople(a.page);
      await expect(a.page.getByRole('link', { name: /Grace Hopper/ })).toBeVisible();
      await a.page.getByRole('link', { name: /Ada Lovelace/ }).click();
      await expect(a.page.locator('input[type="time"]')).toHaveValue('08:15:00');
      await expect(a.page.locator('textarea')).toHaveValue('Mother of computing.');

      await backToPeople(b.page);
      await expect(b.page.getByRole('link', { name: /Grace Hopper/ })).toBeVisible();
      await b.page.getByRole('link', { name: /Ada Lovelace/ }).click();
      await expect(b.page.locator('input[type="time"]')).toHaveValue('08:15:00');
      await expect(b.page.locator('textarea')).toHaveValue('Mother of computing.');
    } finally {
      await closeDevices(a, b);
    }
  });

  test('a same-field concurrent edit resolves identically on both devices', async ({ browser }) => {
    test.setTimeout(60_000);
    const a = await newDevice(browser);
    const b = await newDevice(browser);
    try {
      await a.page.goto(`${baseUrl}/#/people`);
      await createPerson(a.page, {
        name: 'Concurrent Edit Subject',
        date: '1990-01-01',
        latitude: '0',
        longitude: '0',
      });
      await signIn(a.page, USERNAME, PASSWORD);
      await waitSynced(a.page);

      await b.page.goto(`${baseUrl}/#/people`);
      await signIn(b.page, USERNAME, PASSWORD);
      await waitSynced(b.page);
      await b.page.getByRole('link', { name: /Concurrent Edit Subject/ }).click();

      await a.context.setOffline(true);
      await b.context.setOffline(true);

      await a.page.getByLabel('Place of birth', { exact: true }).fill('London');
      await a.page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(a.page.getByText('Saved on this device.')).toBeVisible();

      await b.page.getByLabel('Place of birth', { exact: true }).fill('Paris');
      await b.page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(b.page.getByText('Saved on this device.')).toBeVisible();

      await a.context.setOffline(false);
      await b.context.setOffline(false);
      await reloadAndWaitSynced(a.page);
      await reloadAndWaitSynced(b.page);

      const aValue = await a.page.getByLabel('Place of birth', { exact: true }).inputValue();
      const bValue = await b.page.getByLabel('Place of birth', { exact: true }).inputValue();
      expect(aValue).toBe(bValue);
      expect(['London', 'Paris']).toContain(aValue);
    } finally {
      await closeDevices(a, b);
    }
  });

  test('a delete on one device is not resurrected by a concurrent offline edit on the other', async ({ browser }) => {
    test.setTimeout(60_000);
    const a = await newDevice(browser);
    const b = await newDevice(browser);
    try {
      await a.page.goto(`${baseUrl}/#/people`);
      await createPerson(a.page, {
        name: 'To Be Deleted',
        date: '1990-01-01',
        latitude: '0',
        longitude: '0',
      });
      await signIn(a.page, USERNAME, PASSWORD);
      await waitSynced(a.page);

      await b.page.goto(`${baseUrl}/#/people`);
      await signIn(b.page, USERNAME, PASSWORD);
      await waitSynced(b.page);
      await b.page.getByRole('link', { name: /To Be Deleted/ }).click();

      await a.context.setOffline(true);
      await b.context.setOffline(true);

      // A deletes the person (a tombstone field write, not a real removal) while offline. The
      // account already holds people from earlier tests in this file, so "gone" is checked by
      // section membership rather than by the empty-list message.
      await a.page.getByRole('button', { name: 'Delete To Be Deleted', exact: true }).click();
      await expect(a.page.getByRole('link', { name: /To Be Deleted/ })).toHaveCount(0);
      await expect(a.page.locator('section.deleted')).toContainText('To Be Deleted');

      // B, unaware of the delete, edits an unrelated field on the same person while offline.
      await b.page.locator('textarea').fill('Still editing…');
      await b.page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(b.page.getByText('Saved on this device.')).toBeVisible();

      await a.context.setOffline(false);
      await b.context.setOffline(false);
      await reloadAndWaitSynced(a.page);
      await reloadAndWaitSynced(b.page);

      // The delete wins on both devices: gone from the active list, present only as a tombstone.
      await backToPeople(b.page);
      await expect(a.page.getByRole('link', { name: /To Be Deleted/ })).toHaveCount(0);
      await expect(b.page.getByRole('link', { name: /To Be Deleted/ })).toHaveCount(0);
      await expect(a.page.locator('section.deleted')).toContainText('To Be Deleted');
      await expect(b.page.locator('section.deleted')).toContainText('To Be Deleted');
    } finally {
      await closeDevices(a, b);
    }
  });
});
