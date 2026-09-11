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
  readonly password_hash: string;
  readonly is_admin: number;
  readonly created_at: string;
  readonly disabled_at: string | null;
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

/** Only `login.ts` needs the hash itself; everywhere else gets the shape above. */
export function getUserCredentialsByUsername(
  db: Database,
  username: string,
): { user: User; passwordHash: string } | null {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
  return row ? { user: toUser(row), passwordHash: row.password_hash } : null;
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
