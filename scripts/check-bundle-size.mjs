/**
 * Bundle-size gate for the production build (#73).
 *
 * What is measured is the **eager graph**: the entry chunk plus every chunk it reaches
 * through a static import, which is exactly the set a first-time visitor downloads before
 * anything renders. Measuring the entry chunk alone was right while it was nearly the whole
 * app, and became misleading once the screens were split out (#338) — splitting a module out
 * of `index-*.js` into a chunk that `index-*.js` still statically imports shrinks the entry
 * chunk while changing nothing a visitor experiences.
 *
 * Alongside the budget, each thing that is supposed to be lazy is asserted to be *reachable
 * only* dynamically: the Swiss Ephemeris WASM engine (~570 KiB), Leaflet (~145 KiB, #159),
 * the per-screen chart modules and the admin panel (#338). Those assertions are what
 * actually verify "lazy-loaded" — replace a dynamic `import()` with a static one and the
 * chunk lands in the eager graph, which fails here with a message that names the cause
 * rather than just a number that grew.
 *
 *   node scripts/check-bundle-size.mjs
 *
 * Run after `npm run build`, against dist/assets/.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const assetsDir = 'dist/assets';

// The eager graph is ~515 KiB of gzip-eligible source today. This leaves real headroom for
// growth while still catching an accidental large dependency, or a lazy chunk quietly
// becoming an eager one.
const EAGER_JS_BUDGET_BYTES = 650 * 1024;

const entries = await readdir(assetsDir);

const mainChunks = entries.filter((name) => name.startsWith('index-') && name.endsWith('.js'));
if (mainChunks.length !== 1) {
  throw new Error(
    `expected exactly one main entry chunk (index-*.js) in ${assetsDir}, found: ${mainChunks.join(', ')}`,
  );
}
const [mainChunk] = mainChunks;

/**
 * Chunks reachable from `mainChunk` by static import, transitively.
 *
 * Read out of the emitted code rather than out of a build manifest, so the gate needs no
 * extra build configuration and measures what was actually shipped. A bundler emits its
 * static imports as literal specifiers at the top of a chunk; a dynamic one is an
 * `import(...)` call, which this pattern does not match — which is the whole distinction
 * being drawn.
 */
async function eagerGraph(entry) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const name = queue.pop();
    const code = await readFile(join(assetsDir, name), 'utf8');
    for (const match of code.matchAll(/(?:^|[\s;}])(?:import|export)[^;]*?from\s*["']\.\/([\w.-]+\.js)["']/g)) {
      const target = match[1];
      if (seen.has(target)) continue;
      seen.add(target);
      queue.push(target);
    }
  }
  return seen;
}

const eager = await eagerGraph(mainChunk);
let eagerBytes = 0;
for (const name of eager) eagerBytes += (await stat(join(assetsDir, name))).size;

if (eagerBytes > EAGER_JS_BUDGET_BYTES) {
  throw new Error(
    `the eager JS graph is ${String(eagerBytes)} bytes across ${String(eager.size)} chunk(s) — ` +
      `${[...eager].sort().join(', ')} — over the ${String(EAGER_JS_BUDGET_BYTES)}-byte budget. ` +
      'If this growth is expected, raise EAGER_JS_BUDGET_BYTES in scripts/check-bundle-size.mjs ' +
      "deliberately — don't let it drift unnoticed.",
  );
}

/**
 * Something that must exist as its own chunk *and* stay out of the eager graph. Both halves
 * are needed: a chunk that exists but is statically imported is downloaded up front anyway,
 * which is the failure the existence check on its own cannot see.
 */
const mustStayLazy = [
  {
    pattern: /^swisseph-.*\.(js|wasm)$/,
    what: 'the Swiss Ephemeris WASM engine',
    cost: 'the ~570 KiB WASM engine, whether or not they ever view a chart',
  },
  {
    // Leaflet has no `exports`/`module` field, so Vite resolves the dynamic `import('leaflet')`
    // in BirthPlaceMap.tsx to its `main` entry, dist/leaflet-src.js — hence the chunk name
    // below rather than a plain `leaflet-*`.
    pattern: /^leaflet-src-.*\.js$/,
    what: "Leaflet, behind BirthPlaceMap.tsx's dynamic import()",
    cost: 'the ~145 KiB map library, whether or not they ever open the birth-place picker',
  },
  {
    pattern: /^person-screens-.*\.js$/,
    what: 'the person-scoped screens (#338)',
    cost: 'every chart view and its share of src/chart/**, before the people list renders',
  },
  {
    pattern: /^AdminPanel-.*\.js$/,
    what: 'the admin panel (#338)',
    cost: 'a screen almost no visitor has a route to',
  },
];

const found = [];
for (const { pattern, what, cost } of mustStayLazy) {
  const chunks = entries.filter((name) => pattern.test(name));
  if (chunks.length === 0) {
    throw new Error(
      `no separate ${String(pattern)} chunk found in ${assetsDir} — ${what} appears to have been bundled ` +
        `into another chunk instead of staying behind its dynamic import(). Every visitor would now download ${cost}.`,
    );
  }
  const eagerly = chunks.filter((name) => eager.has(name));
  if (eagerly.length > 0) {
    throw new Error(
      `${what} is in its own chunk (${eagerly.join(', ')}) but the entry graph imports it statically, so every ` +
        `visitor downloads ${cost} regardless. Something replaced a dynamic import() with a static one.`,
    );
  }
  found.push(...chunks);
}

console.log(
  `Eager JS graph: ${String(eagerBytes)} bytes across ${String(eager.size)} chunk(s) ` +
    `(budget ${String(EAGER_JS_BUDGET_BYTES)}): ${[...eager].sort().join(', ')}. ` +
    `Kept lazy: ${found.join(', ')}.`,
);
