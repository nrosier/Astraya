import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg: { version: string } = JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string };

/**
 * Separate build for the service worker, run after the main `vite build`.
 *
 * It has to be a build of its own: `src/sw.ts` must come out as a classic
 * (IIFE) script, not the ESM the main app uses, because service-worker
 * registration with `{ type: 'module' }` is not universally supported — and
 * Rollup cannot emit two different output formats from one build config.
 * `emptyOutDir: false` keeps this from wiping out what the main build just
 * produced in `dist/`.
 */
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
    emptyOutDir: false,
    lib: {
      entry: 'src/sw.ts',
      formats: ['iife'],
      name: 'AstrayaServiceWorker',
      fileName: () => 'sw.js',
    },
  },
});
