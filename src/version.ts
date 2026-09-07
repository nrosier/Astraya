/**
 * Build-time version information.
 *
 * These are substituted by Vite's `define` at build time, so the running app can
 * state exactly which release it is — a requirement for the in-app changelog, and
 * for the AGPL obligation to point users at the corresponding source.
 */

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT_AT__: string;

export const APP_VERSION: string = __APP_VERSION__;
/** Short commit SHA, or 'unknown' outside CI. */
export const APP_COMMIT: string = __APP_COMMIT__;
export const APP_BUILT_AT: string = __APP_BUILT_AT__;

export const SOURCE_URL = 'https://github.com/nrosier/Astraya';

/** Source for *this* build, which is what the AGPL requires us to offer. */
export const SOURCE_URL_FOR_BUILD: string = APP_COMMIT === 'unknown' ? SOURCE_URL : `${SOURCE_URL}/tree/${APP_COMMIT}`;

/**
 * Absolute URL for a repo-relative path such as `docs/RELEASING.md`.
 *
 * Bundled Markdown (the changelog) uses relative links, which resolve against the
 * repository when read on GitHub but resolve against nothing when rendered in-app.
 * Pinned to this build's commit, so a link's target matches the text around it.
 */
export function sourceFileUrl(path: string): string {
  const base = APP_COMMIT === 'unknown' ? `${SOURCE_URL}/blob/main` : `${SOURCE_URL}/blob/${APP_COMMIT}`;
  return `${base}/${path.replace(/^\.?\//, '')}`;
}
