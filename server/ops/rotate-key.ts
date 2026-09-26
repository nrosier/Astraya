/**
 * Re-encrypt every stored operation under a new `ASTRAYA_ENCRYPTION_KEY` (#340).
 *
 *   ASTRAYA_DB_PATH=./data/astraya.db \
 *   ASTRAYA_ENCRYPTION_KEY=<the key in use now> \
 *   ASTRAYA_NEW_ENCRYPTION_KEY=<the replacement> \
 *     node server/ops/rotate-key.ts
 *
 * Without this, a leaked `ASTRAYA_ENCRYPTION_KEY` had no remediation short of hand-written
 * SQL: the key is not derived from anything and every row's ciphertext depends on it, so
 * changing the environment variable alone makes the whole log undecryptable.
 *
 * **What rotates is the key material, not `CURRENT_KEY_VERSION`.** That column records
 * which *scheme* a row was encrypted under (see `crypto.ts`), and AES-256-GCM with a
 * per-row IV is still the scheme afterwards — bumping it would claim a format change that
 * did not happen, and would make a future real scheme change unable to tell the two apart.
 *
 * Runs with the server stopped. Not exposed as an admin route on purpose: it holds both
 * keys and rewrites every row, which is an operator action with shell access, not something
 * that should be reachable with a session cookie.
 */
import { resolve } from 'node:path';
import { openDatabase, type Database } from '../db.ts';
import { decryptPayload, encryptPayload } from './crypto.ts';

interface EncryptedRow {
  readonly seq: number;
  readonly payload: Buffer;
  readonly iv: Buffer | null;
}

export interface RotationResult {
  readonly rotated: number;
  /** Rows with a null `iv` — written before at-rest encryption existed, so there is nothing to re-key. */
  readonly plaintext: number;
}

/**
 * Re-encrypt in one transaction.
 *
 * All or nothing matters more here than anywhere else in this codebase: a partial rotation
 * leaves a database in which neither key decrypts every row, and there is no key version
 * distinguishing them, so recovery would mean trial-decrypting row by row. A fresh IV per
 * row rather than the stored one, because reusing an IV across two keys is safe but
 * reusing it across two *encryptions* is the one mistake GCM does not forgive, and a
 * future edit to this function must not be one step away from it.
 *
 * Throws on the first row that will not decrypt under `currentKey`, before writing
 * anything — a wrong "current" key must fail as a wrong key, not as a half-rotated log.
 */
export function rotateEncryptionKey(db: Database, currentKey: Buffer, newKey: Buffer): RotationResult {
  const rows = db.prepare('SELECT seq, payload, iv FROM ops ORDER BY seq').all() as unknown as EncryptedRow[];

  const reEncrypted: { seq: number; payload: Buffer; iv: Buffer }[] = [];
  let plaintext = 0;
  for (const row of rows) {
    if (!row.iv) {
      plaintext += 1;
      continue;
    }
    let decrypted: Buffer;
    try {
      decrypted = decryptPayload(row.payload, row.iv, currentKey);
    } catch (error) {
      throw new Error(
        `ops row seq=${String(row.seq)} does not decrypt under the current key, so nothing was rotated. ` +
          'Check ASTRAYA_ENCRYPTION_KEY against the key the server is running with.',
        { cause: error },
      );
    }
    const { ciphertext, iv } = encryptPayload(decrypted, newKey);
    reEncrypted.push({ seq: row.seq, payload: ciphertext, iv });
  }

  const update = db.prepare('UPDATE ops SET payload = ?, iv = ? WHERE seq = ?');
  db.exec('BEGIN');
  try {
    for (const row of reEncrypted) update.run(row.payload, row.iv, row.seq);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { rotated: reEncrypted.length, plaintext };
}

function requireKey(name: string): Buffer {
  const encoded = process.env[name];
  if (encoded === undefined || encoded === '') throw new Error(`${name} is not set.`);
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes of base64, got ${String(key.length)}.`);
  return key;
}

/** True when this module is the process entry point rather than an import — same test as `server/index.ts`. */
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`;

if (isEntryPoint) {
  const currentKey = requireKey('ASTRAYA_ENCRYPTION_KEY');
  const newKey = requireKey('ASTRAYA_NEW_ENCRYPTION_KEY');
  if (currentKey.equals(newKey)) throw new Error('ASTRAYA_NEW_ENCRYPTION_KEY is the same key — nothing to rotate.');

  const dbPath = process.env.ASTRAYA_DB_PATH ?? resolve(import.meta.dirname, '..', '..', 'data', 'astraya.db');
  const db = openDatabase(dbPath);
  try {
    const { rotated, plaintext } = rotateEncryptionKey(db, currentKey, newKey);
    console.log(
      `Re-encrypted ${String(rotated)} operation row(s) under the new key` +
        (plaintext > 0 ? `; left ${String(plaintext)} pre-encryption row(s) untouched` : '') +
        '. Set ASTRAYA_ENCRYPTION_KEY to the new key and restart the server.',
    );
  } finally {
    db.close();
  }
}
