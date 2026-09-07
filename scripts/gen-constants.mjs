/**
 * Generates src/ephemeris/generated-constants.ts from the installed sweph-wasm.
 *
 * Swiss Ephemeris has ~290 numeric constants: body ids, calculation flags,
 * ayanamsas, house systems, event codes. Transcribing them by hand is a
 * correctness risk — one wrong digit silently changes what is computed, with no
 * error. So they are read off a live instance of the library, which is more
 * authoritative than its type declarations (several flags, SEFLG_SIDEREAL and
 * SEFLG_TOPOCTR among them, are computed at runtime and typed only as `number`).
 *
 *   node scripts/gen-constants.mjs           regenerate
 *   node scripts/gen-constants.mjs --check   fail if the committed file drifted
 *
 * test/generated-constants.test.ts runs the check, so a dependency bump that
 * moves a body id or a flag bit cannot pass CI unnoticed.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFileFetch } from './node-file-fetch.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src', 'ephemeris', 'generated-constants.ts');

installFileFetch();
const { default: SwissEPH } = await import('sweph-wasm');
const swe = await SwissEPH.init();

const { version } = JSON.parse(await readFile(join(root, 'node_modules', 'sweph-wasm', 'package.json'), 'utf8'));

const names = [...new Set([...Object.keys(swe), ...Object.getOwnPropertyNames(Object.getPrototypeOf(swe))])]
  .filter((k) => /^(SE_|SEFLG_)/.test(k))
  .sort();

const numeric = [];
const strings = [];
for (const name of names) {
  const value = swe[name];
  if (typeof value === 'number' && Number.isFinite(value)) numeric.push([name, value]);
  else if (typeof value === 'string') strings.push([name, value]);
  else throw new Error(`gen-constants: ${name} has unexpected type ${typeof value}`);
}

if (numeric.length < 250) {
  throw new Error(
    `gen-constants: only found ${numeric.length} numeric constants; the library surface may have changed`,
  );
}
// Sanity-check a few well-known values. If these are wrong, everything downstream
// is wrong silently, so refuse to write the file.
const expected = {
  SE_SUN: 0,
  SE_MOON: 1,
  SE_CHIRON: 15,
  SE_AST_OFFSET: 10000,
  SEFLG_SWIEPH: 2,
  SEFLG_SPEED: 256,
  SEFLG_SIDEREAL: 65536,
};
for (const [name, want] of Object.entries(expected)) {
  if (swe[name] !== want)
    throw new Error(`gen-constants: sanity check failed — ${name} is ${swe[name]}, expected ${want}`);
}

const fmt = (entries) =>
  entries.map(([n, v]) => `  ${n}: ${typeof v === 'string' ? JSON.stringify(v) : v},`).join('\n');

const source = `/**
 * Swiss Ephemeris numeric constants, read from a live sweph-wasm ${version} instance.
 *
 * DO NOT EDIT BY HAND. Regenerate with: node scripts/gen-constants.mjs
 *
 * These are the C library's own values, not transcriptions. The accompanying
 * test fails if the installed package no longer agrees with this file.
 */

/** Version of sweph-wasm these constants were read from. */
export const SWEPH_WASM_VERSION = ${JSON.stringify(version)};

/** Numeric Swiss Ephemeris constants: body ids, flags, ayanamsas, event codes. */
export const SE = {
${fmt(numeric)}
} as const;

export type SEConstantName = keyof typeof SE;

/** Swiss Ephemeris auxiliary data-file names. */
export const SE_FILES = {
${fmt(strings)}
} as const;
`;

if (process.argv.includes('--check')) {
  const current = await readFile(OUT, 'utf8').catch(() => '');
  if (current !== source) {
    console.error('gen-constants: src/ephemeris/generated-constants.ts is out of date.');
    console.error('Run: node scripts/gen-constants.mjs');
    process.exit(1);
  }
  console.log(
    `gen-constants: up to date (${numeric.length} numeric, ${strings.length} file names, sweph-wasm ${version})`,
  );
} else {
  await writeFile(OUT, source);
  console.log(
    `gen-constants: wrote ${numeric.length} numeric + ${strings.length} file constants from sweph-wasm ${version}`,
  );
}
