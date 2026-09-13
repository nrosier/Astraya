/**
 * The golden path for the astrocartography/Local Space map (#171): a person with a known birth
 * time, opening the Astrocartography screen from their page, the map rendering, a line-type
 * checkbox changing what's drawn, and the SVG export downloading — the same real worker/DOM/
 * download machinery `chart-golden-path.spec.ts` exercises for the natal wheel.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { build } from '../server/index.ts';
import { createPerson, gotoAndSettle } from './support.ts';

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

test('a person with a known birth time gets an Astrocartography map and the SVG export downloads', async ({ page }) => {
  test.setTimeout(60_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  await page.getByRole('link', { name: 'Astrocartography', exact: true }).click();
  await expect(page.getByRole('heading', { name: /astrocartography/i, level: 1 })).toBeVisible();
  await expect(page.locator('div.acg-map')).toBeVisible();
  await expect(page.locator('div.acg-map svg')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download SVG', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('ada-lovelace-astrocartography.svg');

  const contents = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of contents) chunks.push(chunk as Buffer);
  const svg = Buffer.concat(chunks).toString('utf-8');
  expect(svg).toContain('<svg');
});

test('unchecking a line type removes it from the map', async ({ page }) => {
  test.setTimeout(60_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  await page.getByRole('link', { name: 'Astrocartography', exact: true }).click();
  await expect(page.locator('div.acg-map svg')).toBeVisible();

  const mcLines = page.locator('div.acg-map .acg-line-mc');
  const before = await mcLines.count();
  expect(before).toBeGreaterThan(0);

  await page.getByLabel('MC (Midheaven)').uncheck();
  await expect(mcLines).toHaveCount(0);
});

test('enabling Local Space adds lines for the checked bodies', async ({ page }) => {
  test.setTimeout(60_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  await page.getByRole('link', { name: 'Astrocartography', exact: true }).click();
  await expect(page.locator('div.acg-map svg')).toBeVisible();

  const localSpaceLines = page.locator('div.acg-map .acg-line-local-space');
  await expect(localSpaceLines).toHaveCount(0);

  await page.getByLabel('Show Local Space lines for the checked bodies').check();
  await expect(localSpaceLines.first()).toBeVisible();
});

test('a person with an unknown birth time is told the map needs one', async ({ page }) => {
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Unknown Time',
    date: '1990-01-01',
    latitude: '40.7128',
    longitude: '-74.006',
  });

  await page.getByRole('link', { name: 'Astrocartography', exact: true }).click();
  await expect(page.getByText(/needs a known birth time/)).toBeVisible();
});
