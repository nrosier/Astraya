import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const pkg: { version: string } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

/** Short commit SHA for the About page and the AGPL source link. */
function commitSha(): string {
  // CI provides this; a source tarball with no .git has neither, hence the fallback.
  if (process.env.GITHUB_SHA !== undefined) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commitSha()),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    target: 'es2022',
    // The Swiss Ephemeris data files are large and immutable per release; they
    // are served from public/ephe and fetched at runtime, never bundled.
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // The WASM module takes a moment to instantiate on first use.
    testTimeout: 30_000,
  },
});
