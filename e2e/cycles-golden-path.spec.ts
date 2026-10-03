/**
 * The golden path for planetary cycles (#410): opening the screen from the People page lists the
 * Jupiter-Saturn great conjunctions with a diagram, switching to the Venus pentagram preset
 * narrows it to the retrograde conjunctions, and the screen has no automatic accessibility
 * violations. Needs no person: it runs on the ephemeris alone.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
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

test('the cycles screen lists the great conjunctions with a diagram, and narrows to the Venus pentagram', async ({
  page,
}) => {
  test.setTimeout(90_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await page.getByRole('link', { name: 'Planetary cycles', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Planetary cycles' })).toBeVisible();

  // Opens on Jupiter-Saturn: the great conjunction of 21 December 2020 is in the table.
  const table = page.getByRole('table');
  await expect(table.getByRole('cell', { name: '2020-12-21 18:20', exact: false })).toBeVisible({ timeout: 60_000 });
  await expect(table).toContainText('Aquarius');
  await expect(page.locator('svg.cycle-diagram')).toBeVisible();
  await expect(page.locator('svg.cycle-diagram .cycle-point').first()).toBeVisible();

  // The Venus pentagram preset keeps only the retrograde (inferior) conjunctions.
  await page.getByLabel('Cycle').selectOption('venus-pentagram');
  await expect(page.getByLabel('Cycle')).toHaveValue('venus-pentagram');
  await expect(page.getByLabel('First body’s motion')).toHaveValue('retrograde');
  await expect(table.getByRole('row').nth(1)).toContainText('Venus');
});

test('the cycles screen has no automatically detectable accessibility violations', async ({ page }) => {
  test.setTimeout(90_000);

  await gotoAndSettle(page, `${baseUrl}/#/cycles`);
  await expect(page.getByRole('table')).toBeVisible({ timeout: 60_000 });

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});

test('a bad year is reported inline instead of searching', async ({ page }) => {
  test.setTimeout(90_000);

  await gotoAndSettle(page, `${baseUrl}/#/cycles`);
  await expect(page.getByRole('table')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('From year').fill('abc');
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('whole years');
});
