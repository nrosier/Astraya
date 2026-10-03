/**
 * The golden path for the electional search (#409): reachable from the People page, searching two
 * days in March 2024 for just the "Moon not void of course" rule reproduces the known void window
 * (19:00 to 02:00 UTC on 8-9 March), a bad field or an empty rule set is reported inline, and the
 * screen has no automatic accessibility violations. Needs no saved person.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { build } from '../server/index.ts';
import { gotoAndSettle } from './support.ts';

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

async function fillLondonWindow(page: Page): Promise<void> {
  await page.getByLabel('From (UTC date)').fill('2024-03-08');
  await page.getByLabel('To (UTC date, inclusive)').fill('2024-03-09');
  await page.getByLabel('Latitude', { exact: true }).fill('51.5072');
  await page.getByLabel('Longitude', { exact: true }).fill('-0.1276');
}

test('searching for just the void-Moon rule reproduces the 8 March 2024 void window', async ({ page }) => {
  test.setTimeout(120_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await page.getByRole('link', { name: 'Electional search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Electional search', level: 1 })).toBeVisible();

  await fillLondonWindow(page);
  // Leave only one rule ticked, so each window is simply "void" or "not void".
  for (const label of [
    'Moon outside the Via Combusta',
    'Mercury direct',
    'Moon not in detriment or fall',
    'Moon waxing',
    'A benefic on an angle',
    'Moon applying to a benefic',
  ]) {
    await page.getByRole('checkbox', { name: new RegExp(label) }).uncheck();
  }
  await page.getByRole('button', { name: 'Find times', exact: true }).click();

  const table = page.getByRole('table');
  await expect(table).toBeVisible({ timeout: 90_000 });
  // The Moon's last aspect (Venus) is at 18:55 UTC and it enters Pisces at 01:03: hourly samples
  // from 19:00 to 01:00 are void, so the window runs 19:00 until 02:00.
  // Anchored to the row's start time: the window before it *ends* at 19:00 and would match too.
  const voidRow = table.getByRole('row', { name: /^2024-03-08 19:00 / });
  await expect(voidRow).toContainText('2024-03-09 02:00');
  await expect(voidRow).toContainText('7 h');
  await expect(voidRow).toContainText('0 of 1');
  await expect(voidRow).toContainText('Moon not void of course');
});

test('an empty rule set, a reversed span and a missing coordinate are reported inline', async ({ page }) => {
  test.setTimeout(60_000);

  await gotoAndSettle(page, `${baseUrl}/#/electional`);
  await fillLondonWindow(page);

  await page.getByLabel('Latitude', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Find times', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('latitude');

  await page.getByLabel('Latitude', { exact: true }).fill('51.5');
  await page.getByLabel('To (UTC date, inclusive)').fill('2024-03-01');
  await page.getByRole('button', { name: 'Find times', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('must not be before');

  await page.getByLabel('To (UTC date, inclusive)').fill('2024-03-09');
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.uncheck();
  await page.getByRole('button', { name: 'Find times', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('at least one rule');
});

test('the electional screen has no automatically detectable accessibility violations', async ({ page }) => {
  test.setTimeout(120_000);

  await gotoAndSettle(page, `${baseUrl}/#/electional`);
  await fillLondonWindow(page);
  await page.getByRole('button', { name: 'Find times', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 90_000 });

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});
