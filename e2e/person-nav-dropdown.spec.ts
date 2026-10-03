/**
 * The person menu's grouped dropdowns (#417): one open at a time, closed by choosing an item, by a
 * click anywhere else and by Escape, and the group holding the current page highlighted without
 * being held open.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
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

async function personWithChart(page: Page): Promise<void> {
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Menu Tester',
    date: '1990-06-15',
    time: '14:30:00',
    latitude: '38.7478',
    longitude: '-85.0672',
  });
}

const group = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const popup = (page: Page, name: string) => page.getByRole('navigation', { name: `${name} subtabs` });

test('opening a second group closes the first, so only one dropdown is ever open', async ({ page }) => {
  test.setTimeout(60_000);
  await personWithChart(page);

  await group(page, 'Transits & Forecast').click();
  await expect(popup(page, 'Transits & Forecast')).toBeVisible();
  await expect(group(page, 'Transits & Forecast')).toHaveAttribute('aria-expanded', 'true');

  await group(page, 'Chart Variants').click();
  await expect(popup(page, 'Chart Variants')).toBeVisible();
  await expect(popup(page, 'Transits & Forecast')).toHaveCount(0);
  await expect(group(page, 'Transits & Forecast')).toHaveAttribute('aria-expanded', 'false');
});

test('pressing the open group’s button again closes it', async ({ page }) => {
  test.setTimeout(60_000);
  await personWithChart(page);

  await group(page, 'Relationship Charts').click();
  await expect(popup(page, 'Relationship Charts')).toBeVisible();
  await group(page, 'Relationship Charts').click();
  await expect(popup(page, 'Relationship Charts')).toHaveCount(0);
});

test('choosing an item navigates and leaves no menu open', async ({ page }) => {
  test.setTimeout(60_000);
  await personWithChart(page);

  await group(page, 'Progressions & Directions').click();
  await popup(page, 'Progressions & Directions').getByRole('link', { name: 'Profections', exact: true }).click();
  await expect(page).toHaveURL(/#\/profections\//);
  await expect(page.getByRole('navigation', { name: /subtabs$/ })).toHaveCount(0);
  // The group holding the current page is highlighted, but not held open.
  await expect(group(page, 'Progressions & Directions')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.person-tab-family.active')).toHaveCount(1);
});

test('a click on empty page, on content, or on another tab closes the open menu', async ({ page }) => {
  test.setTimeout(60_000);
  await personWithChart(page);

  await group(page, 'Chart Variants').click();
  await expect(popup(page, 'Chart Variants')).toBeVisible();
  await page.getByRole('heading', { level: 1 }).click();
  await expect(popup(page, 'Chart Variants')).toHaveCount(0);

  await group(page, 'Chart Variants').click();
  await expect(popup(page, 'Chart Variants')).toBeVisible();
  // The page's own link: no route change follows, so only the outside press can close it.
  await page.getByRole('link', { name: 'Birth record', exact: true }).click();
  await expect(popup(page, 'Chart Variants')).toHaveCount(0);

  await group(page, 'Chart Variants').click();
  await expect(popup(page, 'Chart Variants')).toBeVisible();
  await page.mouse.click(5, 400);
  await expect(popup(page, 'Chart Variants')).toHaveCount(0);
});

test('Escape closes the menu and puts focus back on its button', async ({ page }) => {
  test.setTimeout(60_000);
  await personWithChart(page);

  await group(page, 'Transits & Forecast').click();
  await popup(page, 'Transits & Forecast').getByRole('link').first().focus();
  await page.keyboard.press('Escape');
  await expect(popup(page, 'Transits & Forecast')).toHaveCount(0);
  await expect(group(page, 'Transits & Forecast')).toBeFocused();
});

test('tabbing out of an open group closes it', async ({ page }) => {
  test.setTimeout(60_000);
  await personWithChart(page);

  await group(page, 'Relationship Charts').focus();
  await page.keyboard.press('Enter');
  await expect(popup(page, 'Relationship Charts')).toBeVisible();
  // Past the popup's links and out of the group.
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  await expect(popup(page, 'Relationship Charts')).toHaveCount(0);
});

test('the open menu has no automatically detectable accessibility violations', async ({ page }) => {
  test.setTimeout(60_000);
  await personWithChart(page);

  await group(page, 'Transits & Forecast').click();
  await expect(popup(page, 'Transits & Forecast')).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});
