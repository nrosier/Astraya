/**
 * Teaches Node's `fetch` to read `file://` URLs.
 *
 * The sweph-wasm Emscripten glue is built for the browser: it fetches both
 * `swisseph.wasm` and the `.se1` data files. Rather than reaching into the
 * WASM filesystem behind the library's back, we widen `fetch` so Node runs the
 * exact same load path the browser does — tests then exercise production code,
 * and they run fully offline with no network at all.
 *
 * Install once per process, before importing sweph-wasm.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MIME = { '.wasm': 'application/wasm', '.se1': 'application/octet-stream', '.txt': 'text/plain' };

let installed = false;

export function installFileFetch() {
  if (installed) return;
  installed = true;

  const upstream = globalThis.fetch;
  globalThis.fetch = async function fetchWithFileSupport(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url?.startsWith('file://')) return upstream(input, init);

    const path = fileURLToPath(url);
    if (!existsSync(path)) {
      return new Response(null, { status: 404, statusText: 'Not Found' });
    }
    const ext = path.slice(path.lastIndexOf('.'));
    return new Response(readFileSync(path), {
      status: 200,
      headers: { 'content-type': MIME[ext] ?? 'application/octet-stream' },
    });
  };
}

/** Absolute `file://` base URL for the ephemeris data files, for use in tests. */
export function localEpheBaseUrl(root) {
  return new URL('public/ephe/', new URL(`file://${root.endsWith('/') ? root : root + '/'}`)).href;
}
