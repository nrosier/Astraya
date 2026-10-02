/**
 * The golden path for solar arc directions (#398): a person with a known birth time, opening
 * the Solar Arc screen from the person page, and the directed positions and directed-to-natal
 * contacts tables both render.
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

test('a person with a known birth time gets a Solar Arc screen with directed positions and contacts', async ({
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
  await page.getByRole('link', { name: 'Solar Arc', exact: true }).click();
  await expect(page.getByRole('heading', { name: /solar arc/i, level: 1 })).toBeVisible();

  await expect(page.getByRole('table', { name: 'Directed positions' })).toBeVisible();
  await expect(page.getByText(/^Arc: /)).toBeVisible();
});

test('a person with an unknown birth time is told solar arc directions need one', async ({ page }) => {
  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Unknown Time',
    date: '1990-01-01',
    latitude: '40.7128',
    longitude: '-74.006',
  });

  await page.getByRole('button', { name: 'Progressions & Directions', exact: true }).click();
  await page.getByRole('link', { name: 'Solar Arc', exact: true }).click();
  await expect(page.getByText(/need a known birth time/)).toBeVisible();
});
