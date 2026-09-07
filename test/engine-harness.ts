/**
 * Shared engine instance for tests.
 *
 * Instantiating the WASM module is the slow part of these tests, so it is done
 * once per process and reused.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SwissEphemerisEngine } from '../src/ephemeris/engine.js';

const repoRoot = resolve(import.meta.dirname, '..');

/** `file://` URL for the synced ephemeris assets in `public/ephe`. */
export const localEpheBaseUrl = pathToFileURL(resolve(repoRoot, 'public/ephe') + '/').href;
export const localWasmUrl = pathToFileURL(resolve(repoRoot, 'node_modules/sweph-wasm/dist/wasm/swisseph.wasm')).href;

let shared: SwissEphemerisEngine | undefined;

export async function getEngine(): Promise<SwissEphemerisEngine> {
  if (!shared) {
    shared = new SwissEphemerisEngine({ epheBaseUrl: localEpheBaseUrl, wasmUrl: localWasmUrl });
    await shared.initialize();
  }
  return shared;
}

/** Smallest signed difference between two angles, in arcseconds. */
export function arcsecondsBetween(a: number, b: number): number {
  let diff = (a - b) % 360;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return Math.abs(diff) * 3600;
}
