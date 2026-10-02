/**
 * The golden path for the draconic chart (#398): a person with a known birth time, opening the
 * Draconic screen from the Chart Variants family, and the synthetic draconic chart renders with
 * its own wheel and data tables — no in-screen picker, since the draconic zero-point is always
 * the natal North Node.
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

test('a person with a known birth time gets a Draconic screen with a wheel and data tables', async ({ page }) => {
  test.setTimeout(60_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });
  await page.getByRole('button', { name: 'Chart Variants', exact: true }).click();
  await page.getByRole('link', { name: 'Draconic', exact: true }).click();
  await expect(page.getByRole('heading', { name: /draconic/i, level: 1 })).toBeVisible();

  await expect(page.locator('div.chart-wheel')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Positions' })).toBeVisible();
  await expect(page.locator('.report-section').first()).toBeVisible();
  await expect(page.locator('.report-paragraph p').first()).not.toBeEmpty();
});

test('a person with an unknown birth time is told a draconic chart needs one', async ({ page }) => {
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Unknown Time',
    date: '1990-01-01',
    latitude: '40.7128',
    longitude: '-74.006',
  });

  await page.getByRole('button', { name: 'Chart Variants', exact: true }).click();
  await page.getByRole('link', { name: 'Draconic', exact: true }).click();
  await expect(page.getByText(/needs a complete birth record with a known time/)).toBeVisible();
});
