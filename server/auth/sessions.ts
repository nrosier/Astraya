/**
 * Server-side sessions, not a self-contained signed token.
 *
 * A session is a row, and the row is the source of truth: revoking it — an admin
 * disabling a user, a sign-out — takes effect on the very next request. A
 * stateless JWT can't do that without a revocation list, at which point it's a
 * session table with extra steps. So the cookie carries only a random id; every
 * other fact about the session lives here.
 */
import { randomUUID } from 'node:crypto';
import type { Database } from '../db.ts';

export const SESSION_COOKIE = 'astraya_session';

/** Sliding window: a session dies if unused for this long, not on a fixed calendar date. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A shorter sliding window for OIDC-derived sessions (#75). A local account's disable
 * takes effect immediately (`resolveUser` checks `disabledAt`); an Authentik-side
 * disable is invisible to Astraya once the one-time token exchange is done — there's
 * no token round-trip left to notice it. This bounds "revoked upstream but still
 * signed into Astraya" to about a day, without polling Authentik's introspection
 * endpoint or any other new infrastructure. A deliberate, bounded tradeoff, not an
 * oversight — see the note in `.env.example`.
 */
const OIDC_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface Session {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: string;
  readonly oidcIdToken: string | null;
}

interface SessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly expires_at: string;
  readonly oidc_id_token: string | null;
}

export interface CreateSessionOptions {
  /** The raw ID token JWT this session was minted from — kept only long enough to
   * support RP-initiated logout (#77); `undefined`/absent for a local-account session. */
  readonly oidcIdToken?: string;
}

export function createSession(db: Database, userId: string, options: CreateSessionOptions = {}): Session {
  const id = randomUUID();
  const now = new Date().toISOString();
  const ttl = options.oidcIdToken !== undefined ? OIDC_SESSION_TTL_MS : SESSION_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  const oidcIdToken = options.oidcIdToken ?? null;
  db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, last_seen_at, oidc_id_token) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, userId, now, expiresAt, now, oidcIdToken);
  return { id, userId, expiresAt, oidcIdToken };
}

/**
 * Looks up a session by id, returning `null` if it doesn't exist or has expired.
 * An expired row is left in place rather than deleted here — cleanup is not this
 * function's job, and a read path that also writes is a read path that can fail
 * for reasons unrelated to reading.
 */
export function getSession(db: Database, sessionId: string): Session | null {
  const row = db.prepare('SELECT id, user_id, expires_at, oidc_id_token FROM sessions WHERE id = ?').get(sessionId) as
    SessionRow | undefined;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return { id: row.id, userId: row.user_id, expiresAt: row.expires_at, oidcIdToken: row.oidc_id_token };
}

/** Extends the sliding expiry window and records activity. Call once per authenticated request. */
export function touchSession(db: Database, sessionId: string): void {
  const row = db.prepare('SELECT oidc_id_token FROM sessions WHERE id = ?').get(sessionId) as
    { readonly oidc_id_token: string | null } | undefined;
  if (!row) return;
  const ttl = row.oidc_id_token !== null ? OIDC_SESSION_TTL_MS : SESSION_TTL_MS;
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?').run(now, expiresAt, sessionId);
}

export function revokeSession(db: Database, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

/** Used when disabling a user: existing sessions must die immediately, not merely block re-login. */
export function revokeAllSessionsForUser(db: Database, userId: string): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
