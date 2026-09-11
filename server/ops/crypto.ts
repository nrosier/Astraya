/**
 * At-rest encryption for `ops.payload` (#92).
 *
 * The server never interprets an operation (ADR 0002) — there is no "birth time
 * field" or "notes field" to encrypt selectively at this layer, only one opaque
 * blob per row. So the whole payload is encrypted whole, rather than the
 * per-field scheme #92 was originally written against before #102 replaced the
 * relational schema it assumed.
 *
 * AES-256-GCM: authenticated, so a tampered or corrupted row fails loudly on
 * decrypt (a thrown error) rather than returning silently-wrong bytes.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/** Bumped only if the encryption scheme itself changes. #92's re-encryption/rotation command is future work — this column is populated now so that work needs no migration. */
export const CURRENT_KEY_VERSION = 1;

export interface EncryptedPayload {
  readonly ciphertext: Buffer;
  readonly iv: Buffer;
}

export function encryptPayload(plaintext: Buffer, key: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  // The auth tag travels with the ciphertext in the one `payload` column the
  // schema has, rather than needing a column of its own.
  return { ciphertext: Buffer.concat([encrypted, cipher.getAuthTag()]), iv };
}

/**
 * Throws on a tampered or corrupted row — GCM's tag check fails closed, so this
 * never returns a silently-wrong buffer (#92's "decryption failure is a hard
 * error, never a silent empty value").
 */
export function decryptPayload(ciphertextWithTag: Buffer, iv: Buffer, key: Buffer): Buffer {
  if (ciphertextWithTag.length < AUTH_TAG_BYTES) {
    throw new Error('Encrypted payload is too short to contain an auth tag.');
  }
  const boundary = ciphertextWithTag.length - AUTH_TAG_BYTES;
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(ciphertextWithTag.subarray(boundary));
  return Buffer.concat([decipher.update(ciphertextWithTag.subarray(0, boundary)), decipher.final()]);
}

/**
 * Reads and validates `ASTRAYA_ENCRYPTION_KEY`. `null` means unset — the relay
 * stays disabled (see `server/ops/routes.ts`) rather than the whole server
 * refusing to boot, which would break local accounts and anonymous use that have
 * nothing to do with sync. A key that *is* set but the wrong length is a
 * deployment mistake, not a "sync is off" state, so that throws immediately.
 */
export function loadEncryptionKey(): Buffer | null {
  const encoded = process.env.ASTRAYA_ENCRYPTION_KEY;
  if (encoded === undefined || encoded === '') return null;
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(`ASTRAYA_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes of base64, got ${key.length}.`);
  }
  return key;
}
