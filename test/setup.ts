/**
 * Vitest setup.
 *
 * Teaches Node's `fetch` to read `file://` URLs so `sweph-wasm` — whose
 * Emscripten glue is browser-only and fetches its own assets — loads from
 * `public/ephe` with no network. Tests then exercise the exact same load path
 * that runs in the browser, rather than a Node-specific shortcut.
 */
import { installFileFetch } from '../scripts/node-file-fetch.mjs';

installFileFetch();
