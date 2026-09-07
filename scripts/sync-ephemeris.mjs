/**
 * Copies the pinned Swiss Ephemeris assets out of node_modules into public/ephe.
 *
 * Runs before dev and build. Verifies size and SHA-256 against the manifest in
 * src/ephemeris/assets.ts, so an upstream repack of sweph-wasm cannot quietly
 * change the ephemeris this app computes from.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'node_modules', 'sweph-wasm');
const dest = join(root, 'public', 'ephe');

// The manifest is TypeScript, so parse the literals rather than importing it.
// Keeping one source of truth is worth a regex; a mismatch is a hard failure.
const manifestSource = await readFile(join(root, 'src', 'ephemeris', 'assets.ts'), 'utf8');
const assets = [
  ...manifestSource.matchAll(
    /\{\s*file:\s*'([^']+)',\s*from:\s*'([^']+)',\s*bytes:\s*([\d_]+),\s*sha256:\s*'([0-9a-f]{64})'/g,
  ),
].map(([, file, from, bytes, sha256]) => ({ file, from, bytes: Number(bytes.replaceAll('_', '')), sha256 }));

if (assets.length === 0) {
  throw new Error('sync-ephemeris: could not parse any assets from src/ephemeris/assets.ts');
}

await mkdir(dest, { recursive: true });

const problems = [];
for (const asset of assets) {
  const source = join(pkg, asset.from);
  let bytes;
  try {
    bytes = await readFile(source);
  } catch {
    problems.push(`${asset.file}: not found at ${asset.from} — is sweph-wasm installed?`);
    continue;
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== asset.bytes) {
    problems.push(`${asset.file}: expected ${asset.bytes} bytes, got ${bytes.byteLength}`);
    continue;
  }
  if (sha256 !== asset.sha256) {
    problems.push(`${asset.file}: SHA-256 mismatch\n    expected ${asset.sha256}\n    actual   ${sha256}`);
    continue;
  }
  await writeFile(join(dest, asset.file), bytes);
  console.log(`  ✓ ${asset.file.padEnd(16)} ${String(bytes.byteLength).padStart(9)} bytes`);
}

if (problems.length > 0) {
  console.error('\nsync-ephemeris failed:\n' + problems.map((p) => `  ✗ ${p}`).join('\n'));
  console.error(
    '\nIf sweph-wasm was upgraded on purpose, re-verify the new files against a\n' +
      'known-good chart and update the digests in src/ephemeris/assets.ts.\n',
  );
  process.exit(1);
}

// Guard the bundle-size decision: only the pinned files may sit in public/ephe.
const expected = new Set(assets.map((a) => a.file));
const stray = (await readdir(dest)).filter((f) => !expected.has(f) && f !== '.gitignore');
if (stray.length > 0) {
  console.error(`\nsync-ephemeris: unexpected files in public/ephe: ${stray.join(', ')}`);
  console.error('Astraya ships only the pinned assets. Remove these or add them to the manifest.');
  process.exit(1);
}

const total = (await Promise.all(assets.map(async (a) => (await stat(join(dest, a.file))).size))).reduce(
  (a, b) => a + b,
  0,
);
console.log(`\nsynced ${assets.length} assets, ${(total / 1024 / 1024).toFixed(2)} MB total\n`);
