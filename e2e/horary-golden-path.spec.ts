/**
 * The golden path for the horary chart (#406): reachable from the People page, casting a chart
 * for a question's moment and place shows the five considerations before judgment alongside the
 * chart, a bad field is reported inline, and the screen has no automatic accessibility
 * violations. Needs no saved person.
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

async function castLondonChart(page: Page): Promise<void> {
  await page.getByLabel('Date the question was asked').fill('2024-03-08');
  await page.getByLabel('Local time').fill('12:00');
  await page.getByLabel('Latitude', { exact: true }).fill('51.5072');
  await page.getByLabel('Longitude', { exact: true }).fill('-0.1276');
  await page.getByRole('button', { name: 'Cast chart', exact: true }).click();
}

test('casting a horary chart shows the considerations before judgment and the chart', async ({ page }) => {
  test.setTimeout(90_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await page.getByRole('link', { name: 'Horary chart', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Horary chart', level: 1 })).toBeVisible();

  await castLondonChart(page);

  await expect(page.getByRole('heading', { name: 'Considerations before judgment' })).toBeVisible({
    timeout: 60_000,
  });
  const items = page.locator('.horary-considerations li');
  await expect(items).toHaveCount(5);
  for (const label of [
    'Ascendant too early',
    'Ascendant too late',
    'Moon void of course',
    'Moon in the Via Combusta',
    'Saturn in the seventh house',
  ]) {
    await expect(items.filter({ hasText: label })).toHaveCount(1);
  }
  // Every one says in words whether it applies, so colour is never the only cue.
  for (const item of await items.all()) await expect(item).toContainText(/Applies|Clear/);
  await expect(page.locator('.horary-verdict')).toBeVisible();
  await expect(page.locator('div.chart-wheel')).toBeVisible();
  // Cast in Regiomontanus by default: the chart's own header says which system was used.
  await expect(page.getByLabel('House system')).toHaveValue('R');
});

test('a missing date is reported inline instead of casting', async ({ page }) => {
  test.setTimeout(90_000);

  await gotoAndSettle(page, `${baseUrl}/#/horary`);
  // A date input cannot hold an impossible day, so the realistic bad date is an empty one.
  await page.getByLabel('Date the question was asked').fill('');
  await page.getByLabel('Latitude', { exact: true }).fill('51.5');
  await page.getByLabel('Longitude', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Cast chart', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('real date');
  await expect(page.locator('.horary-considerations')).toHaveCount(0);
});

test('the horary screen has no automatically detectable accessibility violations', async ({ page }) => {
  test.setTimeout(90_000);

  await gotoAndSettle(page, `${baseUrl}/#/horary`);
  await castLondonChart(page);
  await expect(page.locator('div.chart-wheel')).toBeVisible({ timeout: 60_000 });

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});
