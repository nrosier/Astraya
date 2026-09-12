/**
 * The golden path for synastry (#172): two people with known birth times, opening the
 * Synastry screen from the first person's page, picking the second from the in-screen
 * dropdown, and the bi-wheel and aspect table render with a CSV download.
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

test('two people with known birth times get a Synastry screen with a bi-wheel and aspect table', async ({ page }) => {
  test.setTimeout(60_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });
  await page.getByRole('link', { name: '← People' }).click();
  await createPerson(page, {
    name: 'Charles Babbage',
    date: '1820-12-26',
    time: '10:00:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  await page.getByRole('link', { name: '← People' }).click();
  await page.getByRole('link').filter({ hasText: 'Ada Lovelace' }).click();
  await page.getByRole('link', { name: 'Synastry', exact: true }).click();
  await expect(page.getByRole('heading', { name: /synastry/i })).toBeVisible();

  await page.getByLabel('Compare with').selectOption({ label: 'Charles Babbage' });

  await expect(page.locator('div.chart-wheel')).toBeVisible();
  await expect(page.locator('div.chart-wheel svg')).toHaveCount(1);
  await expect(page.getByRole('table', { name: 'Aspects' })).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download CSV', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('ada-lovelace-charles-babbage-synastry-aspects.csv');
});

test('a person with an unknown birth time is told synastry needs one', async ({ page }) => {
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Unknown Time',
    date: '1990-01-01',
    latitude: '40.7128',
    longitude: '-74.006',
  });

  await page.getByRole('link', { name: 'Synastry', exact: true }).click();
  await expect(page.getByText(/needs a complete birth record with a known time/)).toBeVisible();
});
