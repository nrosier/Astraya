/**
 * The birth-place map (#159): a second, complementary way to set the same Latitude/Longitude
 * fields `createPerson`/`support.ts` already exercises via the box inputs. Coverage here is
 * intentionally e2e-only — see `BirthPlaceMap.tsx`'s doc comment for why it has no unit test.
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
