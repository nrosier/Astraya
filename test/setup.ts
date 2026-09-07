/**
 * Test environment setup.
 *
 * Vitest runs in Node, deliberately: it makes the ephemeris tests exercise the same
 * asset-loading path the browser takes, with no network. That choice means two browser
 * APIs have to be supplied here.
 */
import { installFileFetch } from '../scripts/node-file-fetch.mjs';

installFileFetch();

/**
 * IndexedDB, via `fake-indexeddb`.
 *
 * The store is the one place where a bug loses a user's data outright, so its tests run
 * against a real IndexedDB implementation — versions, upgrade transactions, key ordering
 * and transaction aborts included — rather than against a mock that would agree with
 * whatever `db.ts` happens to do.
 */
import 'fake-indexeddb/auto';
