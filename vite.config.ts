import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';
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

/**
 * Writes `dist/precache-manifest.json`: every emitted `.html`/`.js`/`.css` path,
 * for the service worker's `install` handler to precache (#99). Vite's
 * content-hashed filenames aren't statically knowable from `src/sw.ts` itself,
 * so this is what bridges that gap — the service worker's own build
 * (`vite.sw.config.ts`) runs after this one and never touches this file.
 */
function precacheManifest(): Plugin {
  return {
    name: 'astraya-precache-manifest',
    writeBundle(options, bundle) {
      // "/" covers the navigation request for index.html; listing "/index.html"
      // too would just precache the identical response under a second key.
      const paths = ['/', ...Object.keys(bundle).map((fileName) => `/${fileName}`)].filter(
        (path) => path !== '/index.html' && (path === '/' || /\.(html|js|css)$/.test(path)),
      );
      writeFileSync(`${options.dir ?? 'dist'}/precache-manifest.json`, JSON.stringify(paths));
    },
  };
}

export default defineConfig({
  plugins: [react(), precacheManifest()],
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
