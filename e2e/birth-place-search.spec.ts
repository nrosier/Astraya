/**
 * The birth-place search (#290): the sole way to set the same Latitude/Longitude fields
 * `createPerson`/`support.ts` already exercises via the box inputs, since a search a
 * click-to-confirm result never silently sets them on its own. Coverage here is intentionally
 * e2e-only — see `BirthPlaceSearch.tsx`'s doc comment for why it has no unit test;
 * `forward-geocode.ts`'s own lookup logic has its Vitest unit tests in
 * `test/forward-geocode.test.ts`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { build } from '../server/index.ts';
import { gotoAndSettle, labeledField } from './support.ts';

let dir: string;
let app: FastifyInstance;
let baseUrl: string;

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'astraya-e2e-'));
  process.env.LOG_LEVEL = 'silent';

  app = await build({ dbPath: join(dir, 'astraya.db') });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind to a port');
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
});

test.afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

async function readFields(page: Page): Promise<{ latitude: number; longitude: number }> {
  const latitude = await labeledField(page, /^Latitude/, 'input[type="number"]').inputValue();
  const longitude = await labeledField(page, /^Longitude/, 'input[type="number"]').inputValue();
  return { latitude: Number(latitude), longitude: Number(longitude) };
}

// Real calls to Nominatim from an automated test run would be flaky (rate-limited) and a policy
// violation in its own right if run repeatedly in CI: https://operations.osmfoundation.org/policies/nominatim/.
async function stubNominatimSearch(page: Page, response: unknown, options: { status?: number } = {}): Promise<void> {
  await page.route('**/nominatim.openstreetmap.org/search**', async (route) => {
    await route.fulfill({
      status: options.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

async function startPersonWithoutCoordinates(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add a person', exact: true }).click();
  await labeledField(page, /^Name/, 'input[type="text"]').fill('New Person');
  await page.locator('input[type="date"]').fill('1990-06-15');
}

test('"Search for a place by name" stays visible whether or not coordinates already exist (#290)', async ({ page }) => {
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await startPersonWithoutCoordinates(page);

  await expect(labeledField(page, /^Search for a place by name/, 'input[type="text"]')).toBeVisible();

  await labeledField(page, /^Latitude/, 'input[type="number"]').fill('51.5072');
  await labeledField(page, /^Longitude/, 'input[type="number"]').fill('-0.1276');

  await expect(labeledField(page, /^Search for a place by name/, 'input[type="text"]')).toBeVisible();
});

test('a single search match is still shown as a click-to-confirm list, and picking it fills coordinates and Place of birth (#290)', async ({
  page,
}) => {
  await stubNominatimSearch(page, [{ lat: '48.8566', lon: '2.3522', display_name: 'Paris, Île-de-France, France' }]);
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await startPersonWithoutCoordinates(page);

  await labeledField(page, /^Search for a place by name/, 'input[type="text"]').fill('Paris');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  const result = page.getByRole('button', { name: 'Paris, Île-de-France, France', exact: true });
  await expect(result).toBeVisible();
  await result.click();

  await expect(labeledField(page, /^Latitude/, 'input[type="number"]')).toHaveValue('48.8566');
  await expect(labeledField(page, /^Longitude/, 'input[type="number"]')).toHaveValue('2.3522');
  await expect(labeledField(page, /^Place of birth/, 'input[type="text"]')).toHaveValue('Paris, Île-de-France, France');
});

test('multiple search matches are each shown as a separate clickable result (#290)', async ({ page }) => {
  await stubNominatimSearch(page, [
    { lat: '48.8566', lon: '2.3522', display_name: 'Paris, Île-de-France, France' },
    { lat: '33.6609', lon: '-95.5555', display_name: 'Paris, Texas, United States' },
  ]);
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await startPersonWithoutCoordinates(page);

  await labeledField(page, /^Search for a place by name/, 'input[type="text"]').fill('Paris');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Paris, Île-de-France, France', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paris, Texas, United States', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Paris, Texas, United States', exact: true }).click();

  await expect(labeledField(page, /^Latitude/, 'input[type="number"]')).toHaveValue('33.6609');
  await expect(labeledField(page, /^Longitude/, 'input[type="number"]')).toHaveValue('-95.5555');
});

test('a search with no matches shows an inline "not found" message (#290)', async ({ page }) => {
  await stubNominatimSearch(page, []);
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await startPersonWithoutCoordinates(page);

  await labeledField(page, /^Search for a place by name/, 'input[type="text"]').fill('Nowhereville');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'No matching place was found' })).toBeVisible();
});

test('a search-request failure shows an inline message, and coordinates are still editable by hand (#290)', async ({
  page,
}) => {
  await stubNominatimSearch(page, [], { status: 503 });
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await startPersonWithoutCoordinates(page);

  await labeledField(page, /^Search for a place by name/, 'input[type="text"]').fill('Paris');
  await page.getByRole('button', { name: 'Search', exact: true }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'The place search failed' })).toBeVisible();

  await labeledField(page, /^Latitude/, 'input[type="number"]').fill('51.5072');
  await labeledField(page, /^Longitude/, 'input[type="number"]').fill('-0.1276');
  expect(await readFields(page)).toEqual({ latitude: 51.5072, longitude: -0.1276 });
});
