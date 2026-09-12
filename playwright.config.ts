import { defineConfig } from '@playwright/test';

/**
 * Drives the real, built app (`npm run build`) against a real server —
 * unlike `test/*.test.ts`, which never load the frontend bundle. See
 * `e2e/multi-device-sync.spec.ts` for why this exists (#107): the client's
 * op-log convergence and the relay's blind pass-through can only be jointly
 * proven by two independent browser contexts talking to a real server.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  fullyParallel: false,
  // multi-device-sync.spec.ts has intermittently hung in CI (never locally) on its
  // first store.mutate()/navigation of a fresh context — see #229. Root cause is
  // still open; retrying on CI only turns a rare stall into a pass without hiding
  // it locally, where it has never once reproduced.
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
