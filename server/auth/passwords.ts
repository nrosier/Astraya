/**
 * Password hashing: Argon2id, never bcrypt, certainly never a bare SHA.
 *
 * `@node-rs/argon2` ships prebuilt native binaries per platform rather than
 * compiling from source, for the same reason `server/db.ts` picked `node:sqlite`
 * over `better-sqlite3` — no per-architecture compile step to keep working.
 *
 * Its defaults (memory cost 19 MiB, 2 iterations, 1 lane) already match OWASP's
 * minimum recommendation, so they're used as-is rather than re-specified — the
 * hash string carries its own parameters, so raising them later needs no
 * migration; old hashes stay verifiable.
 */
import { hash, verify } from '@node-rs/argon2';

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

const MIN_PASSWORD_LENGTH = 12;

/**
 * Common enough to appear in every breach corpus, so length alone wouldn't catch
 * them. Not a substitute for a real strength meter — a self-hosted single-tenant
 * instance doesn't need one, but shipped defaults and keyboard-walk passwords are
 * worth refusing outright, especially for the account that can create every
 * other account.
 */
const KNOWN_WEAK_PASSWORDS = new Set([
  'password',
  'password123',
  'passw0rd',
  '123456789012',
  'qwertyuiop12',
  'letmein12345',
  'changeme1234',
  'admin1234567',
]);

/** Used by the setup and admin-user-creation flows, which must refuse a weak password rather than warn about it. */
export function passwordIsTooWeak(password: string, username: string): boolean {
  if (password.length < MIN_PASSWORD_LENGTH) return true;
  const lower = password.toLowerCase();
  if (KNOWN_WEAK_PASSWORDS.has(lower)) return true;
  if (lower === username.toLowerCase()) return true;
  return false;
}

/**
 * A fixed hash of a placeholder value, verified against on a login attempt for a
 * username that doesn't exist. Without this, "no such user" would skip the
 * Argon2 verify step entirely and return faster than "wrong password" — a timing
 * side channel that reveals which usernames are registered.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$aHgimUprOaSUTEnrWih36g$Dibszbfrru5KQwx0Ga7ajZHbMjFRdaOjQpdp4xBIlOI';
