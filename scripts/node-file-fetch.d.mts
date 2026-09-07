/**
 * Types for the Node file:// fetch shim. Hand-written because the shim itself is
 * plain .mjs: it has to run under bare `node` in scripts with no build step.
 */

/**
 * Widen `globalThis.fetch` so it also resolves `file://` URLs. Idempotent.
 *
 * This exists because the sweph-wasm Emscripten glue is browser-only and fetches
 * both the .wasm and the .se1 files. Shimming fetch means tests exercise the
 * exact production load path rather than a Node-specific shortcut.
 */
export function installFileFetch(): void;

/** `file://` base URL for a local ephemeris directory, with a trailing slash. */
export function localEpheBaseUrl(root: string): string;
