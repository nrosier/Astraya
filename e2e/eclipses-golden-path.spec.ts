/**
 * The golden path for eclipses (#404): the screen is reachable from the People page, lists the
 * four eclipses of 2024 with their degrees, shows which natal point an eclipse touches once a
 * person is chosen, and has no automatic accessibility violations.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
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

test('the eclipses screen lists the four eclipses of 2024 with their degrees', async ({ page }) => {
  test.setTimeout(90_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await page.getByRole('link', { name: 'Eclipses', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Eclipses', level: 1 })).toBeVisible();

  await page.getByLabel('From year').fill('2024');
  await page.getByLabel('To year').fill('2024');
  await page.getByRole('button', { name: 'Find', exact: true }).click();

  const table = page.getByRole('table');
  await expect(table.getByRole('row')).toHaveCount(5, { timeout: 60_000 }); // header + 4
  await expect(table).toContainText('2024-04-08 18:17');
  await expect(table).toContainText('Solar eclipse — total');
  await expect(table).toContainText('Aries');
  await expect(table).toContainText('Lunar eclipse — penumbral');
  await expect(page.getByText('4 eclipses, 2024–2024 (UTC).')).toBeVisible();
});

test('choosing a person shows which of their natal points an eclipse touches', async ({ page }) => {
  test.setTimeout(90_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  // Born 9 April 1990: the Sun at about 19° Aries, where the 8 April 2024 total eclipse fell.
  await createPerson(page, {
    name: 'Eclipse Tester',
    date: '1990-04-09',
    time: '12:00:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  await page.goto(`${baseUrl}/#/eclipses`);
  await page.getByLabel('From year').fill('2024');
  await page.getByLabel('To year').fill('2024');
  await page.getByLabel('Natal chart').selectOption({ label: 'Eclipse Tester' });
  await page.getByRole('button', { name: 'Find', exact: true }).click();

  const row = page.getByRole('row').filter({ hasText: '2024-04-08 18:17' });
  await expect(row).toContainText('Sun Conjunction', { timeout: 60_000 });
});

test('the eclipses screen has no automatically detectable accessibility violations', async ({ page }) => {
  test.setTimeout(90_000);

  await gotoAndSettle(page, `${baseUrl}/#/eclipses`);
  await expect(page.getByRole('table')).toBeVisible({ timeout: 60_000 });

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});

test('a span that is too long is refused inline', async ({ page }) => {
  test.setTimeout(90_000);

  await gotoAndSettle(page, `${baseUrl}/#/eclipses`);
  await expect(page.getByRole('table')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('From year').fill('1900');
  await page.getByLabel('To year').fill('2100');
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('at most 60 years');
});
