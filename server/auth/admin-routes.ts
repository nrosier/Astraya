/**
 * Admin user management (#135): list, create, reset-password, disable/enable,
 * promote/demote, a pre-delete impact preview, and delete. Every route here sits
 * behind `requireAdmin` — `requireUser`/the ops relay are untouched by this file.
 *
 * No route here reads another user's `people`/`charts` data. The one exception,
 * `deletion-impact`, decrypts only counts (distinct entity ids) for one target
 * user immediately before a destructive delete — see `deletion-impact.ts`'s own
 * comment for why that's a narrow, deliberate exception, not a new capability.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db.ts';
import { getUserByUsername, requireAdmin } from './identity.ts';
import { loadOidcConfig } from './oidc.ts';
import { revokeAllSessionsForUser } from './sessions.ts';
import { loadEncryptionKey } from '../ops/crypto.ts';
import { previewDeletionImpact } from '../ops/deletion-impact.ts';

const PASSWORD_SET_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface AdminUserRow {
  readonly id: string;
  readonly username: string;
  readonly is_admin: number;
  readonly created_at: string;
  readonly disabled_at: string | null;
  readonly last_seen_at: string | null;
}

interface AdminUser {
  readonly id: string;
  readonly username: string;
  readonly isAdmin: boolean;
  readonly createdAt: string;
  readonly disabledAt: string | null;
  readonly lastSeenAt: string | null;
}

function toAdminUser(row: AdminUserRow): AdminUser {
  return {
    id: row.id,
    username: row.username,
    isAdmin: row.is_admin !== 0,
    createdAt: row.created_at,
    disabledAt: row.disabled_at,
    lastSeenAt: row.last_seen_at,
  };
}

function getAdminUser(db: Database, id: string): AdminUser | null {
  const row = db
    .prepare(
      `SELECT users.id, users.username, users.is_admin, users.created_at, users.disabled_at,
              MAX(sessions.last_seen_at) AS last_seen_at
       FROM users LEFT JOIN sessions ON sessions.user_id = users.id
       WHERE users.id = ?
       GROUP BY users.id`,
    )
    .get(id) as AdminUserRow | undefined;
  return row ? toAdminUser(row) : null;
}

/** True iff `userId` is an admin and the sole remaining one — disabling/demoting/deleting them would leave the instance unrecoverable through the UI. */
function isOnlyRemainingAdmin(db: Database, userId: string): boolean {
  const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as { is_admin: number } | undefined;
  if (!row || row.is_admin === 0) return false;
  const count = db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get() as { count: number };
  return count.count <= 1;
}

function mintPasswordSetToken(db: Database, userId: string): string {
  const token = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + PASSWORD_SET_TOKEN_TTL_MS).toISOString();
  db.prepare('UPDATE users SET password_set_token = ?, password_set_token_expires_at = ? WHERE id = ?').run(
    token,
    expiresAt,
    userId,
  );
  return token;
}

function setPasswordUrl(token: string): string {
  return `/#/set-password?token=${token}`;
}

interface CreateUserBody {
  readonly username?: unknown;
  readonly isAdmin?: unknown;
}

export function registerAdminRoutes(app: FastifyInstance, db: Database): void {
  app.get('/api/admin/users', { preHandler: requireAdmin(db) }, async (_request, reply) => {
    const rows = db
      .prepare(
        `SELECT users.id, users.username, users.is_admin, users.created_at, users.disabled_at,
                MAX(sessions.last_seen_at) AS last_seen_at
         FROM users LEFT JOIN sessions ON sessions.user_id = users.id
         GROUP BY users.id
         ORDER BY users.created_at`,
      )
      .all() as unknown as AdminUserRow[];
    return reply.send({ users: rows.map(toAdminUser) });
  });

  app.post<{ Body: CreateUserBody }>('/api/admin/users', { preHandler: requireAdmin(db) }, async (request, reply) => {
    if (loadOidcConfig()) {
      return reply.code(409).send({ error: 'Local accounts cannot be created while OIDC is configured' });
    }

    const { username, isAdmin } = request.body;
    if (typeof username !== 'string' || username === '') {
      return reply.code(400).send({ error: 'username is required' });
    }
    if (isAdmin !== undefined && typeof isAdmin !== 'boolean') {
      return reply.code(400).send({ error: 'isAdmin must be a boolean' });
    }
    if (getUserByUsername(db, username)) return reply.code(409).send({ error: 'Username already taken' });

    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, NULL, ?, ?)').run(
      id,
      username,
      isAdmin === true ? 1 : 0,
      now,
    );
    const token = mintPasswordSetToken(db, id);
    const user = getAdminUser(db, id);
    return reply.code(201).send({ user, setPasswordUrl: setPasswordUrl(token) });
  });

  app.post<{ Params: { id: string } }>(
    '/api/admin/users/:id/reset-password',
    { preHandler: requireAdmin(db) },
    async (request, reply) => {
      const user = getAdminUser(db, request.params.id);
      if (!user) return reply.code(404).send({ error: 'No such user' });
      const token = mintPasswordSetToken(db, user.id);
      return reply.send({ user, setPasswordUrl: setPasswordUrl(token) });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/users/:id/disable',
    { preHandler: requireAdmin(db) },
    async (request, reply) => {
      const user = getAdminUser(db, request.params.id);
      if (!user) return reply.code(404).send({ error: 'No such user' });
      if (isOnlyRemainingAdmin(db, user.id)) {
        return reply.code(409).send({ error: 'Cannot disable the only remaining admin' });
      }
      db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?').run(new Date().toISOString(), user.id);
      revokeAllSessionsForUser(db, user.id);
      return reply.send({ user: getAdminUser(db, user.id) });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/users/:id/enable',
    { preHandler: requireAdmin(db) },
    async (request, reply) => {
      const user = getAdminUser(db, request.params.id);
      if (!user) return reply.code(404).send({ error: 'No such user' });
      db.prepare('UPDATE users SET disabled_at = NULL WHERE id = ?').run(user.id);
      return reply.send({ user: getAdminUser(db, user.id) });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/users/:id/promote',
    { preHandler: requireAdmin(db) },
    async (request, reply) => {
      const user = getAdminUser(db, request.params.id);
      if (!user) return reply.code(404).send({ error: 'No such user' });
      db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user.id);
      return reply.send({ user: getAdminUser(db, user.id) });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/admin/users/:id/demote',
    { preHandler: requireAdmin(db) },
    async (request, reply) => {
      const user = getAdminUser(db, request.params.id);
      if (!user) return reply.code(404).send({ error: 'No such user' });
      if (isOnlyRemainingAdmin(db, user.id)) {
        return reply.code(409).send({ error: 'Cannot demote the only remaining admin' });
      }
      db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(user.id);
      return reply.send({ user: getAdminUser(db, user.id) });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/admin/users/:id/deletion-impact',
    { preHandler: requireAdmin(db) },
    async (request, reply) => {
      const user = getAdminUser(db, request.params.id);
      if (!user) return reply.code(404).send({ error: 'No such user' });
      const impact = previewDeletionImpact(db, user.id, loadEncryptionKey());
      return reply.send(impact);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/users/:id',
    { preHandler: requireAdmin(db) },
    async (request, reply) => {
      const user = getAdminUser(db, request.params.id);
      if (!user) return reply.code(404).send({ error: 'No such user' });
      if (isOnlyRemainingAdmin(db, user.id)) {
        return reply.code(409).send({ error: 'Cannot delete the only remaining admin' });
      }
      // ON DELETE CASCADE on both sessions.user_id and ops.user_id takes care of the rest.
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      return reply.send({ ok: true });
    },
  );
}
