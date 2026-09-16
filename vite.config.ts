import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadEnv, type Plugin } from 'vite';
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

/**
 * Writes `dist/precache-manifest.json`: every emitted `.html`/`.js`/`.css` path,
 * for the service worker's `install` handler to precache (#99). Vite's
 * content-hashed filenames aren't statically knowable from `src/sw.ts` itself,
 * so this is what bridges that gap — the service worker's own build
 * (`vite.sw.config.ts`) runs after this one and never touches this file.
 *
 * Paths are prefixed with `base` so they match what the app is actually served
 * at (a GitHub Pages project site, for example, isn't served from `/`).
 */
function precacheManifest(base: string): Plugin {
  return {
    name: 'astraya-precache-manifest',
    writeBundle(options, bundle) {
      // `base` covers the navigation request for index.html; listing
      // `${base}index.html` too would just precache the identical response
      // under a second key.
      const paths = [base, ...Object.keys(bundle).map((fileName) => `${base}${fileName}`)].filter(
        (path) => path !== `${base}index.html` && (path === base || /\.(html|js|css)$/.test(path)),
      );
      writeFileSync(`${options.dir ?? 'dist'}/precache-manifest.json`, JSON.stringify(paths));
    },
  };
}

/**
 * `public/manifest.webmanifest` is a static, committed JSON file — it isn't part
 * of the HTML asset graph Vite's `base` rewriting covers, so its root-absolute
 * `id`/`start_url`/`scope`/icon `src` fields need a manual pass when serving
 * from a subpath. A no-op when `base` is `/`.
 */
function patchManifestBase(base: string): Plugin {
  return {
    name: 'astraya-patch-manifest-base',
    writeBundle(options) {
      if (base === '/') return;
      const dir = options.dir ?? 'dist';
      const path = `${dir}/manifest.webmanifest`;
      const manifest = JSON.parse(readFileSync(path, 'utf8')) as {
        id?: string;
        start_url?: string;
        scope?: string;
        icons?: { src: string }[];
      };
      const prefixed = (value: string): string => (value.startsWith('/') ? `${base}${value.slice(1)}` : value);
      if (manifest.id !== undefined) manifest.id = prefixed(manifest.id);
      if (manifest.start_url !== undefined) manifest.start_url = prefixed(manifest.start_url);
      if (manifest.scope !== undefined) manifest.scope = prefixed(manifest.scope);
      for (const icon of manifest.icons ?? []) icon.src = prefixed(icon.src);
      writeFileSync(path, JSON.stringify(manifest));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const base = env.VITE_BASE_PATH ?? '/';

  return {
    base,
    plugins: [react(), precacheManifest(base), patchManifestBase(base)],
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
      include: ['test/**/*.test.ts', 'test/**/*.test.tsx', 'src/**/*.test.ts'],
      // The WASM module takes a moment to instantiate on first use.
      testTimeout: 30_000,
    },
  };
});
