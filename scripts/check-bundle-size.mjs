/**
 * Bundle-size gate for the production build (#73).
 *
 * Two things matter here, not one: the main entry chunk should not silently
 * balloon, and the Swiss Ephemeris WASM engine — the one asset big enough to
 * matter (~570 KiB) — must stay code-split into its own chunk rather than
 * getting pulled into the main bundle every visitor downloads up front. The
 * second check is what actually verifies "ephemeris assets lazy-loaded": if
 * a future change replaced the worker's dynamic `import('sweph-wasm')` with
 * a static one, Vite would inline it into the main chunk and this script's
 * chunk-count check would catch it even before the size budget did.
 *
 *   node scripts/check-bundle-size.mjs
 *
 * Run after `npm run build`, against dist/assets/.
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const assetsDir = 'dist/assets';

// Current main chunk is ~678 KiB gzip-eligible source; this leaves real
// headroom for growth while still catching an accidental large dependency
// or an un-code-split import landing in the main bundle.
const MAIN_CHUNK_BUDGET_BYTES = 900 * 1024;

const entries = await readdir(assetsDir);

const mainChunks = entries.filter((name) => name.startsWith('index-') && name.endsWith('.js'));
if (mainChunks.length !== 1) {
  throw new Error(
    `expected exactly one main entry chunk (index-*.js) in ${assetsDir}, found: ${mainChunks.join(', ')}`,
  );
}
const [mainChunk] = mainChunks;
const mainChunkSize = (await stat(join(assetsDir, mainChunk))).size;

if (mainChunkSize > MAIN_CHUNK_BUDGET_BYTES) {
  throw new Error(
    `main chunk ${mainChunk} is ${String(mainChunkSize)} bytes, over the ${String(MAIN_CHUNK_BUDGET_BYTES)}-byte budget. ` +
      'If this growth is expected, raise MAIN_CHUNK_BUDGET_BYTES in scripts/check-bundle-size.mjs deliberately — ' +
      "don't let it drift unnoticed.",
  );
}

const ephemerisChunks = entries.filter((name) => /^swisseph-.*\.(js|wasm)$/.test(name));
if (ephemerisChunks.length === 0) {
  throw new Error(
    `no separate swisseph-*.js/.wasm chunk found in ${assetsDir} — the ephemeris engine appears to have been ` +
      'bundled into the main chunk instead of staying behind its dynamic import(). Every visitor would now ' +
      'download the ~570 KiB WASM engine up front, whether or not they ever view a chart.',
  );
}

console.log(
  `Main chunk ${mainChunk}: ${String(mainChunkSize)} bytes (budget ${String(MAIN_CHUNK_BUDGET_BYTES)}). ` +
    `Ephemeris kept in its own chunk(s): ${ephemerisChunks.join(', ')}.`,
);
