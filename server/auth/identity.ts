/**
 * Identity is a boundary, not a branch scattered through handlers.
 *
 * Everything downstream asks this module "who is this request from", and never
 * "was it a local session or OIDC" — that question has exactly one answer site.
 * Today there is one implementation, the local session cookie; OIDC becomes a
 * second implementation feeding the same `User` shape, not a parallel path.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db.ts';
import { SESSION_COOKIE, getSession, touchSession } from './sessions.ts';

export interface User {
  readonly id: string;
  readonly username: string;
  readonly isAdmin: boolean;
  readonly createdAt: string;
  readonly disabledAt: string | null;
}

interface UserRow {
  readonly id: string;
  readonly username: string;
  readonly password_hash: string | null;
  readonly is_admin: number;
  readonly created_at: string;
  readonly disabled_at: string | null;
  readonly oidc_issuer: string | null;
  readonly oidc_subject: string | null;
}

interface PasswordSetTokenRow extends UserRow {
  readonly password_set_token_expires_at: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    isAdmin: row.is_admin !== 0,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
  };
}

export function getUserById(db: Database, id: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function getUserByUsername(db: Database, username: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  return row ? toUser(row) : null;
}

/**
 * Only the login route needs the hash itself; everywhere else gets the shape above.
 * `passwordHash` is `null` for an OIDC-only account — the login route's dummy-hash
 * fallback already treats that exactly like "no such user".
 */
export function getUserCredentialsByUsername(
  db: Database,
  username: string,
): { user: User; passwordHash: string | null } | null {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  return row ? { user: toUser(row), passwordHash: row.password_hash } : null;
}

/** Looks up a user by their OIDC identity, provisioned on a prior sign-in via that same issuer. */
export function getUserByOidcIdentity(db: Database, issuer: string, subject: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE oidc_issuer = ? AND oidc_subject = ?').get(issuer, subject) as
    UserRow | undefined;
  return row ? toUser(row) : null;
}

/**
 * Creates a new user JIT-provisioned from an OIDC identity (#75) — `is_admin` is always
 * `0`; OIDC never auto-admins (that's phase 6's admin promotion, #135). Throws on a
 * `UNIQUE` violation, which happens when `username` collides with an existing row —
 * whether local or under a different OIDC identity — since silently linking accounts
 * on a username coincidence would let one Authentik user claim another account.
 */
export function createOidcUser(
  db: Database,
  params: { readonly id: string; readonly username: string; readonly issuer: string; readonly subject: string },
): User {
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO users (id, username, password_hash, created_at, oidc_issuer, oidc_subject) VALUES (?, ?, NULL, ?, ?, ?)',
  ).run(params.id, params.username, now, params.issuer, params.subject);
  return { id: params.id, username: params.username, isAdmin: false, createdAt: now, disabledAt: null };
}

/**
 * Looks up a user by an admin-issued one-time link (#135) — used by both
 * "create a local account" and "reset a password", since a fresh row with
 * `password_hash = NULL` and an existing row awaiting a reset are the same
 * mechanism from this function's point of view.
 */
export function getUserByPasswordSetToken(
  db: Database,
  token: string,
): { readonly user: User; readonly expiresAt: string | null } | null {
  const row = db.prepare('SELECT * FROM users WHERE password_set_token = ?').get(token) as
    PasswordSetTokenRow | undefined;
  return row ? { user: toUser(row), expiresAt: row.password_set_token_expires_at } : null;
}

/** Sets the password and clears the token — single-use by construction, not by a separate flag. */
export function consumePasswordSetToken(db: Database, userId: string, passwordHash: string): void {
  db.prepare(
    'UPDATE users SET password_hash = ?, password_set_token = NULL, password_set_token_expires_at = NULL WHERE id = ?',
  ).run(passwordHash, userId);
}

/**
 * Resolves the request's session cookie to a user, or `null` for no session, an
 * expired one, or one whose user has since been disabled. A disabled user's
 * sessions are revoked outright (see `revokeAllSessionsForUser`), but checking
 * `disabledAt` here too closes the gap between disabling a user and that revoke
 * actually running.
 *
 * Touches the session (sliding expiry) as a side effect of a successful
 * resolution — a session that is being used is, by definition, not idle.
 */
export function resolveUser(db: Database, request: FastifyRequest): User | null {
  const sessionId = request.cookies[SESSION_COOKIE];
  if (!sessionId) return null;
  const session = getSession(db, sessionId);
  if (!session) return null;
  const user = getUserById(db, session.userId);
  if (user?.disabledAt !== null) return null;
  touchSession(db, sessionId);
  return user;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

/**
 * A `preHandler` for routes that require a signed-in user. Not applied to any
 * route yet — anonymous mode means the app itself never needs it, and the sync
 * relay it will guard doesn't exist until the next phase. Landing it now means
 * that phase adds zero auth scaffolding of its own.
 */
export function requireUser(db: Database) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = resolveUser(db, request);
    if (!user) {
      await reply.code(401).send({ error: 'Not authenticated' });
      return;
    }
    request.user = user;
  };
}

/** Same as `requireUser`, plus a role check — used only by `admin-routes.ts`. */
export function requireAdmin(db: Database) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = resolveUser(db, request);
    if (!user) {
      await reply.code(401).send({ error: 'Not authenticated' });
      return;
    }
    if (!user.isAdmin) {
      await reply.code(403).send({ error: 'Admin access required' });
      return;
    }
    request.user = user;
  };
}
