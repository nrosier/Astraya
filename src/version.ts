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

export const SOURCE_URL = 'https://github.com/nrosier/Astraea';

/** Source for *this* build, which is what the AGPL requires us to offer. */
export const SOURCE_URL_FOR_BUILD: string = APP_COMMIT === 'unknown' ? SOURCE_URL : `${SOURCE_URL}/tree/${APP_COMMIT}`;
