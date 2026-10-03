/**
 * The golden path (#72): enter birth data, the wheel renders, and an export downloads. No unit
 * test exercises this end-to-end — `chart-compute.ts`/`chart-sheet.ts` are covered in isolation,
 * but never through the actual worker/DOM/download machinery a real browser provides.
 *
 * No sync/auth setup here, unlike `multi-device-sync.spec.ts` (#107): this path never touches
 * an account, so `build()` doesn't need `ASTRAYA_ENCRYPTION_KEY`, and the server-side sync relay
 * stays disabled throughout.
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

test('entering birth data renders the chart wheel and the SVG export downloads', async ({ page }) => {
  test.setTimeout(60_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  await page.getByRole('link', { name: 'Natal chart', exact: true }).click();
  await expect(page.locator('div.chart-wheel')).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download SVG', exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('ada-lovelace-chart.svg');

  const contents = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of contents) chunks.push(chunk as Buffer);
  const svg = Buffer.concat(chunks).toString('utf-8');
  expect(svg).toContain('<svg');
});

test('clicking a glyph on the wheel isolates it and opens a focused-info panel (#400)', async ({ page }) => {
  test.setTimeout(60_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  await page.getByRole('link', { name: 'Natal chart', exact: true }).click();
  await expect(page.locator('div.chart-wheel')).toBeVisible();

  // `.chart-point` is the clickable glyph group; since #412 the Sun's radial stack and its degree
  // tick carry `data-body="sun"` too (so dimming reaches them), which is why this is narrower
  // than the bare attribute.
  const sunGlyph = page.locator('.chart-point[data-body="sun"]');
  await expect(sunGlyph).toHaveCount(1);
  await sunGlyph.click();

  const panel = page.locator('.chart-isolation-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Sun');
  await expect(page.locator('.chart-wheel .chart-dimmed').first()).toBeVisible();

  // Clicking the same glyph again toggles the isolation off.
  await sunGlyph.click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator('.chart-wheel .chart-dimmed')).toHaveCount(0);
});

test('clicking an aspect line isolates just its two endpoint bodies (#400)', async ({ page }) => {
  test.setTimeout(60_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  await page.getByRole('link', { name: 'Natal chart', exact: true }).click();
  await expect(page.locator('div.chart-wheel')).toBeVisible();

  const line = page.locator('[data-aspect-body-a]').first();
  await line.click({ force: true });

  const panel = page.locator('.chart-isolation-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Orb');

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(panel).toHaveCount(0);
});

test('the Jones chart-shape diagram renders alongside its text sentence (#401)', async ({ page }) => {
  test.setTimeout(60_000);

  await gotoAndSettle(page, `${baseUrl}/#/people`);
  await createPerson(page, {
    name: 'Ada Lovelace',
    date: '1815-12-10',
    time: '07:45:00',
    latitude: '51.5072',
    longitude: '-0.1276',
  });

  await page.getByRole('link', { name: 'Natal chart', exact: true }).click();
  await expect(page.getByText(/Chart shape: /)).toBeVisible();
  await expect(page.locator('.chart-shape-diagram')).toBeVisible();
  await expect(page.locator('.chart-shape-diagram .chart-shape-ring')).toBeVisible();
});
