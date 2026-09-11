/**
 * The local-account HTTP surface: sign in, sign out, "who am I", and the
 * one-time bootstrap that creates the first admin. Mounted unconditionally —
 * signing in is optional (the anonymous path elsewhere on this server is
 * untouched), but the routes that make it possible always exist.
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Database } from '../db.ts';
import { adminExists, announceBootstrap, checkBootstrapToken } from './bootstrap.ts';
import {
  getUserByUsername,
  getUserByOidcIdentity,
  getUserCredentialsByUsername,
  createOidcUser,
  resolveUser,
} from './identity.ts';
import { clearLoginThrottle, isLoginThrottled, recordFailedLogin } from './login-throttle.ts';
import { exchangeCode, getEndSessionEndpoint, loadOidcConfig, verifyIdToken } from './oidc.ts';
import { DUMMY_PASSWORD_HASH, hashPassword, passwordIsTooWeak, verifyPassword } from './passwords.ts';
import { SESSION_COOKIE, createSession, getSession, revokeSession } from './sessions.ts';

/** `Secure` only makes sense once the app is actually served over HTTPS. */
function isSecureRequest(request: { protocol: string }): boolean {
  return request.protocol === 'https';
}

interface LoginBody {
  readonly username?: unknown;
  readonly password?: unknown;
}

interface SetupBody {
  readonly token?: unknown;
  readonly username?: unknown;
  readonly password?: unknown;
}

interface OidcCallbackBody {
  readonly code?: unknown;
  readonly codeVerifier?: unknown;
  readonly nonce?: unknown;
}

export function registerAuthRoutes(app: FastifyInstance, db: Database): void {
  announceBootstrap(db, app.log);

  app.post<{ Body: LoginBody }>(
    '/api/auth/login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { username, password } = request.body;
      if (typeof username !== 'string' || typeof password !== 'string' || username === '' || password === '') {
        return reply.code(400).send({ error: 'username and password are required' });
      }

      if (isLoginThrottled(username)) {
        return reply.code(429).send({ error: 'Too many attempts. Try again later.' });
      }

      const credentials = getUserCredentialsByUsername(db, username);
      // Verify against a fixed dummy hash even when the username doesn't exist, so
      // this response takes the same shape and roughly the same time either way —
      // the point is that a client can't tell "no such user" from "wrong password".
      const valid = await verifyPassword(credentials?.passwordHash ?? DUMMY_PASSWORD_HASH, password);

      if (!credentials || !valid || credentials.user.disabledAt !== null) {
        recordFailedLogin(username);
        return reply.code(401).send({ error: 'Invalid username or password' });
      }

      clearLoginThrottle(username);
      const session = createSession(db, credentials.user.id);
      reply.setCookie(SESSION_COOKIE, session.id, {
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecureRequest(request),
        path: '/',
        expires: new Date(session.expiresAt),
      });
      return reply.send({ user: credentials.user });
    },
  );

  app.post('/api/auth/logout', async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE];
    let endSessionUrl: string | undefined;
    if (sessionId) {
      const session = getSession(db, sessionId);
      // Built before revoking: the session row (specifically its stored
      // `oidc_id_token`, #77) is what says whether Authentik needs to be told too.
      if (session?.oidcIdToken) {
        const oidcConfig = loadOidcConfig();
        const endSessionEndpoint = oidcConfig ? await getEndSessionEndpoint(oidcConfig.issuer) : undefined;
        if (oidcConfig && endSessionEndpoint) {
          const url = new URL(endSessionEndpoint);
          url.searchParams.set('id_token_hint', session.oidcIdToken);
          url.searchParams.set('post_logout_redirect_uri', oidcConfig.publicUrl);
          endSessionUrl = url.toString();
        }
      }
      revokeSession(db, sessionId);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.send({ ok: true, ...(endSessionUrl !== undefined ? { endSessionUrl } : {}) });
  });

  app.get('/api/auth/me', async (request, reply) => {
    const user = resolveUser(db, request);
    if (!user) return reply.code(401).send({ error: 'Not authenticated' });
    return reply.send({ user });
  });

  app.get('/api/auth/oidc/config', async (_request, reply) => {
    const oidcConfig = loadOidcConfig();
    if (!oidcConfig) return reply.send({ enabled: false });
    return reply.send({ enabled: true, issuer: oidcConfig.issuer, clientId: oidcConfig.clientId });
  });

  app.post<{ Body: OidcCallbackBody }>(
    '/api/auth/oidc/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const oidcConfig = loadOidcConfig();
      if (!oidcConfig) return reply.code(404).send({ error: 'Not found' });

      const { code, codeVerifier, nonce } = request.body;
      if (typeof code !== 'string' || typeof codeVerifier !== 'string' || typeof nonce !== 'string') {
        return reply.code(400).send({ error: 'code, codeVerifier and nonce are required' });
      }

      let claims: Awaited<ReturnType<typeof verifyIdToken>>;
      try {
        const { idToken } = await exchangeCode({ config: oidcConfig, code, codeVerifier });
        claims = await verifyIdToken(oidcConfig, idToken);
        if (claims.nonce !== nonce) {
          return await reply.code(401).send({ error: 'OIDC sign-in failed' });
        }

        let user = getUserByOidcIdentity(db, oidcConfig.issuer, claims.subject);
        if (!user) {
          const username = claims.preferredUsername ?? claims.subject;
          // A username collision against an existing row — local or a *different*
          // OIDC identity — is rejected rather than silently linked: that would let
          // one Authentik user claim another account by username coincidence.
          if (getUserByUsername(db, username)) {
            return await reply.code(409).send({ error: 'An account with this username already exists' });
          }
          user = createOidcUser(db, { id: randomUUID(), username, issuer: oidcConfig.issuer, subject: claims.subject });
        }
        if (user.disabledAt !== null) {
          return await reply.code(401).send({ error: 'OIDC sign-in failed' });
        }

        const session = createSession(db, user.id, { oidcIdToken: idToken });
        reply.setCookie(SESSION_COOKIE, session.id, {
          httpOnly: true,
          sameSite: 'lax',
          secure: isSecureRequest(request),
          path: '/',
          expires: new Date(session.expiresAt),
        });
        return await reply.send({ user });
      } catch (error) {
        app.log.warn({ error }, 'OIDC callback failed');
        return reply.code(401).send({ error: 'OIDC sign-in failed' });
      }
    },
  );

  app.post<{ Body: SetupBody }>('/api/setup', async (request, reply) => {
    // 404, not 403: a 403 would confirm the route exists as an ongoing attack
    // surface after the instance is already bootstrapped.
    if (adminExists(db)) return reply.code(404).send({ error: 'Not found' });

    const { token, username, password } = request.body;
    if (typeof token !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
      return reply.code(400).send({ error: 'token, username and password are required' });
    }

    const tokenError = checkBootstrapToken(token);
    if (tokenError) return reply.code(401).send({ error: tokenError });

    if (username === '') return reply.code(400).send({ error: 'username is required' });
    if (getUserByUsername(db, username)) return reply.code(409).send({ error: 'Username already taken' });
    if (passwordIsTooWeak(password, username)) return reply.code(400).send({ error: 'Password is too weak' });

    const passwordHash = await hashPassword(password);
    const id = randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO users (id, username, password_hash, is_admin, created_at) VALUES (?, ?, ?, 1, ?)').run(
      id,
      username,
      passwordHash,
      now,
    );
    // Re-announce: an admin now exists, so this clears the in-memory token and the
    // bootstrap flow is done for this process's lifetime (a restart is needed to
    // bootstrap again, which can't happen while an admin row already exists).
    announceBootstrap(db, app.log);

    const session = createSession(db, id);
    reply.setCookie(SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecureRequest(request),
      path: '/',
      expires: new Date(session.expiresAt),
    });
    return reply.code(201).send({ user: { id, username, isAdmin: true, createdAt: now, disabledAt: null } });
  });
}
