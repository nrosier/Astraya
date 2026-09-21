/**
 * The birth-place map (#159): a second, complementary way to set the same Latitude/Longitude
 * fields `createPerson`/`support.ts` already exercises via the box inputs. Also covers "Fill in
 * place name" (#291), the reverse-geocoding button that lives in the same UI slot as "Use my
 * location", and "Search for a place by name" (#290), the forward-geocoding search row shown
 * above that slot regardless of whether coordinates already exist. Coverage here is
 * intentionally e2e-only — see `BirthPlaceMap.tsx`'s doc comment for why it has no unit test;
 * `reverse-geocode.ts`'s/`forward-geocode.ts`'s own lookup logic has its Vitest unit tests in
 * `test/reverse-geocode.test.ts`/`test/forward-geocode.test.ts`.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { build } from '../server/index.ts';
import { createPerson, gotoAndSettle, labeledField } from './support.ts';

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

// A minimal valid (1x1, transparent) PNG. Real interaction with the map doesn't need real map
// imagery, and hitting the actual tile.openstreetmap.org from an automated test run would be
// both flaky (rate-limited/blocked per OSM's tile usage policy — the exact "unavailable" case
// the last test below exercises deliberately) and, run repeatedly in CI, a policy violation in
// its own right: https://wiki.openstreetmap.org/wiki/Blocked_tiles.
const FIXTURE_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

async function stubTiles(page: Page): Promise<void> {
  await page.route('**/tile.openstreetmap.org/**', async (route) => {
    await route.fulfill({ contentType: 'image/png', body: FIXTURE_TILE });
  });
}

// Real calls to Nominatim from an automated test run would be just as flaky (rate-limited) and
// policy-violating in CI as the real tile calls `stubTiles` above avoids (#291).
async function stubNominatim(page: Page, response: unknown, options: { status?: number } = {}): Promise<void> {
  await page.route('**/nominatim.openstreetmap.org/**', async (route) => {
    await route.fulfill({
      status: options.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

// Scoped to `/search` specifically (rather than reusing `stubNominatim`'s broader `/reverse`-
// shaped route) since the two endpoints return differently-shaped bodies — an array of results
// here, not a single `{ address }` object (#290).
async function stubNominatimSearch(page: Page, response: unknown, options: { status?: number } = {}): Promise<void> {
  await page.route('**/nominatim.openstreetmap.org/search**', async (route) => {
    await route.fulfill({
      status: options.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(response),
    });
  });
}

test('clicking the map fills the Latitude/Longitude fields', async ({ page }) => {
  await stubTiles(page);
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  const before = await readFields(page);
  const canvas = page.locator('.birth-place-map-canvas');
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (box === null) throw new Error('map canvas has no layout box');

  // Off-center, so the resulting point is not indistinguishable from the marker's starting spot.
  await page.mouse.click(box.x + box.width / 2 + 60, box.y + box.height / 2 + 40);

  await expect
    .poll(async () => {
      const after = await readFields(page);
      return after.latitude !== before.latitude || after.longitude !== before.longitude;
    })
    .toBe(true);

  const after = await readFields(page);
  expect(after.latitude).toBeGreaterThanOrEqual(-90);
  expect(after.latitude).toBeLessThanOrEqual(90);
  expect(after.longitude).toBeGreaterThanOrEqual(-180);
  expect(after.longitude).toBeLessThanOrEqual(180);
});

test('dragging the pin fills the Latitude/Longitude fields', async ({ page }) => {
  await stubTiles(page);
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  const before = await readFields(page);
  const marker = page.locator('.leaflet-marker-icon');
  await expect(marker).toBeVisible();
  await marker.scrollIntoViewIfNeeded();
  const markerBox = await marker.boundingBox();
  if (markerBox === null) throw new Error('marker has no layout box');

  const startX = markerBox.x + markerBox.width / 2;
  const startY = markerBox.y + markerBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 50, startY + 30, { steps: 10 });
  await page.mouse.up();

  await expect
    .poll(async () => {
      const after = await readFields(page);
      return after.latitude !== before.latitude || after.longitude !== before.longitude;
    })
    .toBe(true);
});

test('editing the Latitude/Longitude fields moves the pin', async ({ page }) => {
  await stubTiles(page);
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  const marker = page.locator('.leaflet-marker-icon');
  await expect(marker).toBeVisible();
  const before = await marker.boundingBox();
  if (before === null) throw new Error('marker has no layout box');

  await labeledField(page, /^Latitude/, 'input[type="number"]').fill('-33.8688');
  await labeledField(page, /^Longitude/, 'input[type="number"]').fill('151.2093');
  await labeledField(page, /^Longitude/, 'input[type="number"]').blur();

  await expect
    .poll(async () => {
      const after = await marker.boundingBox();
      return after ?? before;
    })
    .not.toEqual(before);
});

test('a tile-server failure shows an unavailable message, and the fields still work', async ({ page }) => {
  test.setTimeout(30_000);

  await page.route('**/tile.openstreetmap.org/**', async (route) => {
    await route.abort();
  });

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  await expect(page.getByRole('alert').filter({ hasText: 'Map tiles could not be loaded' })).toBeVisible({
    timeout: 15_000,
  });

  await labeledField(page, /^Latitude/, 'input[type="number"]').fill('-33.8688');
  await labeledField(page, /^Longitude/, 'input[type="number"]').fill('151.2093');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved on this device.')).toBeVisible();
});

/** Starts a new, still-coordinate-less person: `createPerson` always fills Latitude/Longitude,
 *  but the "Use my location" control (#248) is only offered before either field has a value. */
async function startPersonWithoutCoordinates(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Add a person', exact: true }).click();
  await labeledField(page, /^Name/, 'input[type="text"]').fill('New Person');
  await page.locator('input[type="date"]').fill('1990-06-15');
}

test('"Use my location" pans the map without moving the pin or the fields (#248)', async ({ page }) => {
  await page.context().grantPermissions(['geolocation'], { origin: baseUrl });
  await page.context().setGeolocation({ latitude: 48.8566, longitude: 2.3522 });

  const tileRequests: string[] = [];
  await page.route('**/tile.openstreetmap.org/**', async (route) => {
    tileRequests.push(route.request().url());
    await route.fulfill({ contentType: 'image/png', body: FIXTURE_TILE });
  });

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await startPersonWithoutCoordinates(page);

  const before = {
    latitude: await labeledField(page, /^Latitude/, 'input[type="number"]').inputValue(),
    longitude: await labeledField(page, /^Longitude/, 'input[type="number"]').inputValue(),
  };

  await page.getByRole('button', { name: 'Use my location', exact: true }).click();

  // The initial view is a world zoom (2); panning/zooming to a specific point (6) is the
  // observable proxy for "the map moved to the geolocated position" without reaching into
  // Leaflet's internals — a fresh request for a zoom-6 tile only happens after that move.
  await expect.poll(() => tileRequests.some((url) => /\/6\/\d+\/\d+\.png/.test(url))).toBe(true);

  expect(await labeledField(page, /^Latitude/, 'input[type="number"]').inputValue()).toBe(before.latitude);
  expect(await labeledField(page, /^Longitude/, 'input[type="number"]').inputValue()).toBe(before.longitude);
  await expect(page.getByRole('alert')).not.toBeVisible();
});

test('a denied geolocation permission shows an inline message, and the fields still work (#248)', async ({ page }) => {
  // No `grantPermissions` call: Playwright denies an ungranted geolocation request by default.
  await stubTiles(page);
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await startPersonWithoutCoordinates(page);

  await page.getByRole('button', { name: 'Use my location', exact: true }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'Location permission was denied' })).toBeVisible();

  await labeledField(page, /^Latitude/, 'input[type="number"]').fill('51.5072');
  await labeledField(page, /^Longitude/, 'input[type="number"]').fill('-0.1276');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved on this device.')).toBeVisible();

  // Once coordinates exist, the map already centers on them — the control has nothing left to do.
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).not.toBeVisible();
});

test('"Fill in place name" only appears once coordinates exist, in the same slot "Use my location" vacates (#291)', async ({
  page,
}) => {
  await stubTiles(page);
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await startPersonWithoutCoordinates(page);

  await expect(page.getByRole('button', { name: 'Fill in place name', exact: true })).not.toBeVisible();

  await labeledField(page, /^Latitude/, 'input[type="number"]').fill('51.5072');
  await labeledField(page, /^Longitude/, 'input[type="number"]').fill('-0.1276');

  await expect(page.getByRole('button', { name: 'Fill in place name', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use my location', exact: true })).not.toBeVisible();
});

test('"Fill in place name" fills the Place of birth field from coordinates (#291)', async ({ page }) => {
  await stubTiles(page);
  await stubNominatim(page, { address: { city: 'Paris', country: 'France' } });
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '48.8566',
    longitude: '2.3522',
  });

  await page.getByRole('button', { name: 'Fill in place name', exact: true }).click();
  await expect(labeledField(page, /^Place of birth/, 'input[type="text"]')).toHaveValue('Paris, France');
});

test('a reverse-geocoding result with no address shows an inline "not found" message (#291)', async ({ page }) => {
  await stubTiles(page);
  await stubNominatim(page, {});
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '0',
    longitude: '0',
  });

  await page.getByRole('button', { name: 'Fill in place name', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'No place name could be found' })).toBeVisible();
});

test('a reverse-geocoding failure shows an inline message, and the field is still editable by hand (#291)', async ({
  page,
}) => {
  await stubTiles(page);
  await stubNominatim(page, {}, { status: 503 });
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  await page.getByRole('button', { name: 'Fill in place name', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The place name lookup failed' })).toBeVisible();

  await labeledField(page, /^Place of birth/, 'input[type="text"]').fill('London');
  await expect(labeledField(page, /^Place of birth/, 'input[type="text"]')).toHaveValue('London');
});

test('"Search for a place by name" stays visible whether or not coordinates already exist, unlike "Use my location" (#290)', async ({
  page,
}) => {
  await stubTiles(page);
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
  await stubTiles(page);
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
  await stubTiles(page);
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
  await stubTiles(page);
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
  await stubTiles(page);
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
