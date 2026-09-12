/**
 * The golden path for transits (#172): enter birth data with a known time, open the Transit
 * screen from the person page, and the bi-wheel and contacts table render with a CSV
 * download — the same real worker/DOM/download machinery `chart-golden-path.spec.ts`
 * exercises for the chart, applied to the new screen.
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

test('a person with a known birth time gets a Transit screen with a bi-wheel and contacts table', async ({ page }) => {
  test.setTimeout(60_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  await page.getByRole('link', { name: 'Transits', exact: true }).click();
  await expect(page.getByRole('heading', { name: /transits/i })).toBeVisible();
  await expect(page.locator('div.chart-wheel')).toBeVisible();
  await expect(page.locator('div.chart-wheel svg')).toHaveCount(1);
  await expect(page.getByRole('table', { name: 'Contacts' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('ada-lovelace-transit-contacts.csv');
});

test('a person with an unknown birth time is told transits need one', async ({ page }) => {
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Unknown Time',
    date: '1990-01-01',
    latitude: '40.7128',
    longitude: '-74.006',
  });

  await page.getByRole('link', { name: 'Transits', exact: true }).click();
  await expect(page.getByText(/needs a known birth time/)).toBeVisible();
});
