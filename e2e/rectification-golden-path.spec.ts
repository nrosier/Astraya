/**
 * The golden path for birth-time rectification (#408): from a stored person, test every five
 * minutes of a birth day against events that are exact solar-arc contacts for the person's true
 * birth time (08:20), and the true time must come out at the top, with a lift well above average.
 * Also: a bad field is reported inline, and the screen has no automatic accessibility violations.
 *
 * The four event dates are the ones the engine-level test derives for this birth moment (a
 * directed angle exactly on a natal planet, or a directed planet on a natal angle), so this proves
 * the whole path — form, candidate times in the person's time zone, scoring, ranking, display.
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

const EVENT_DATES = ['1999-08-11', '2004-11-06', '2009-01-27', '2014-10-31'];

async function fillEvents(page: Page): Promise<void> {
  for (const [index, date] of EVENT_DATES.entries()) {
    if (index > 0) await page.getByRole('button', { name: 'Add an event', exact: true }).click();
    await page.getByLabel(`Event ${String(index + 1)} date`).fill(date);
  }
}

test('rectifying a day of candidate times recovers the true birth time from exact solar-arc events', async ({
  page,
}) => {
  test.setTimeout(240_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Rectify Me',
    date: '1985-03-12',
    time: '08:20:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  await page.goto(`${baseUrl}/#/rectification`);
  await page.getByLabel('Fill in from a person').selectOption({ label: 'Rectify Me' });
  await expect(page.getByLabel('Birth date')).toHaveValue('1985-03-12');
  await page.getByLabel('Earliest possible time').fill('00:00');
  await page.getByLabel('Latest possible time').fill('23:55');
  await page.getByLabel('Test every').selectOption('5');
  await fillEvents(page);
  await page.getByRole('button', { name: 'Test candidate times', exact: true }).click();

  const table = page.getByRole('table');
  await expect(table).toBeVisible({ timeout: 200_000 });
  // The best candidate is the true time, and clearly above the day's average.
  const best = table.getByRole('row').nth(1);
  await expect(best).toContainText('08:20');
  const lift = Number((await best.getByRole('cell').nth(4).innerText()).replace(/[^\d.]/g, ''));
  expect(lift).toBeGreaterThan(2);
  await expect(page.getByText(/288 candidate times tested/)).toBeVisible();
  // The evidence behind the top times is listed, and the caveat is on the screen.
  await expect(page.locator('.rectification-detail').first()).toBeVisible();
  await expect(page.getByText(/does not prove a time/)).toBeVisible();
});

test('a missing event, an event before birth and a bad time are reported inline', async ({ page }) => {
  test.setTimeout(60_000);

  await gotoAndSettle(page, `${baseUrl}/#/rectification`);
  await page.getByLabel('Birth date').fill('1985-03-12');
  await page.getByLabel('Latitude', { exact: true }).fill('51.5072');
  await page.getByLabel('Longitude', { exact: true }).fill('-0.1276');

  await page.getByRole('button', { name: 'Test candidate times', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('at least one event');

  await page.getByLabel('Event 1 date').fill('1980-01-01');
  await page.getByRole('button', { name: 'Test candidate times', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('after the birth date');

  await page.getByLabel('Event 1 date').fill('2000-01-01');
  await page.getByLabel('Earliest possible time').fill('12:00');
  await page.getByLabel('Latest possible time').fill('11:00');
  await page.getByRole('button', { name: 'Test candidate times', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('must not be before the earliest');
});

test('the rectification screen has no automatically detectable accessibility violations', async ({ page }) => {
  test.setTimeout(120_000);

  await gotoAndSettle(page, `${baseUrl}/#/rectification`);
  await page.getByLabel('Birth date').fill('1985-03-12');
  await page.getByLabel('Latitude', { exact: true }).fill('51.5072');
  await page.getByLabel('Longitude', { exact: true }).fill('-0.1276');
  await page.getByLabel('Earliest possible time').fill('07:00');
  await page.getByLabel('Latest possible time').fill('09:00');
  await page.getByLabel('Test every').selectOption('10');
  await page.getByLabel('Event 1 date').fill(EVENT_DATES[0] ?? '2000-01-01');
  await page.getByRole('button', { name: 'Test candidate times', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible({ timeout: 100_000 });

  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations).toEqual([]);
});
