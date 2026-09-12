/**
 * The golden path for composite charts (#169): two people with known birth times, opening the
 * Composite screen from the first person's page, picking the second from the in-screen
 * dropdown, and the synthetic midpoint chart renders with its own wheel and data tables.
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

test('two people with known birth times get a Composite screen with a wheel and data tables', async ({ page }) => {
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
  await page.getByRole('link', { name: 'Composite', exact: true }).click();
  await expect(page.getByRole('heading', { name: /composite/i, level: 1 })).toBeVisible();

  await page.getByLabel('Compose with').selectOption({ label: 'Charles Babbage' });

  await expect(page.locator('div.chart-wheel')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Positions' })).toBeVisible();
});

test('a person with an unknown birth time is told a composite needs one', async ({ page }) => {
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Unknown Time',
    date: '1990-01-01',
    latitude: '40.7128',
    longitude: '-74.006',
  });

  await page.getByRole('link', { name: 'Composite', exact: true }).click();
  await expect(page.getByText(/needs midpoint houses from both people/)).toBeVisible();
});
