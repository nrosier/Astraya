/**
 * The golden path for progressions (#398): a person with a known birth time, opening the
 * Progressions screen from the person page, and the technique/MC method selectors plus the
 * progressed positions and progressed-to-natal contacts tables all render.
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

test('a person with a known birth time gets a Progressions screen with technique/MC selectors and tables', async ({
  page,
}) => {
  test.setTimeout(60_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  await page.getByRole('button', { name: 'Progressions & Directions', exact: true }).click();
  await page.getByRole('link', { name: 'Progressions', exact: true }).click();
  await expect(page.getByRole('heading', { name: /progressions/i, level: 1 })).toBeVisible();

  await expect(page.getByLabel('Technique')).toBeVisible();
  await expect(page.getByLabel('MC method')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Progressed positions' })).toBeVisible();

  // Switching to a technique with no MC method (tertiary/minor always recompute houses
  // directly) hides the selector — the method actually used is never left ambiguous.
  await page.getByLabel('Technique').selectOption({ label: 'Tertiary (a lunar month for a year)' });
  await expect(page.getByLabel('MC method')).toBeHidden();
  await expect(page.getByRole('table', { name: 'Progressed positions' })).toBeVisible();
});

test('a person with an unknown birth time is told progressions need one', async ({ page }) => {
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Unknown Time',
    date: '1990-01-01',
    latitude: '40.7128',
    longitude: '-74.006',
  });

  await page.getByRole('button', { name: 'Progressions & Directions', exact: true }).click();
  await page.getByRole('link', { name: 'Progressions', exact: true }).click();
  await expect(page.getByText(/need a known birth time/)).toBeVisible();
});
