/**
 * A real, second Fastify instance standing in for Authentik: discovery, JWKS,
 * token exchange, and end-session, all driven by real HTTP the same way
 * `test/sync-engine.test.ts` drives a real server rather than mocking the
 * network. Shared by `test/server-oidc.test.ts` (server-side verification)
 * and `test/session-context.test.tsx` (client wiring), so both exercise the
 * exact same fake IdP rather than each hand-rolling their own.
 */
import Fastify from 'fastify';
import { exportJWK, generateKeyPair, SignJWT, type KeyInput } from 'jose';

const KEY_ID = 'test-key';

export type TokenOutcome = { readonly idToken: string } | { readonly errorStatus: number };

export interface FakeAuthentik {
  readonly baseUrl: string;
  registerCode(code: string, outcome: TokenOutcome): void;
  mintIdToken(
    claims: {
      readonly sub: string;
      readonly nonce?: string;
      readonly preferred_username?: string;
      readonly name?: string;
      readonly iss?: string;
      readonly aud?: string;
      readonly exp?: number;
    },
    signingKey?: KeyInput,
  ): Promise<string>;
  close(): Promise<void>;
}

export async function startFakeAuthentik(clientId: string): Promise<FakeAuthentik> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const codes = new Map<string, TokenOutcome>();

  const app = Fastify({ logger: false });
  // Real Authentik posts `application/x-www-form-urlencoded`, per the token
  // endpoint spec — Fastify has no built-in parser for it, and the real app has
  // no reason to add `@fastify/formbody` as a dependency just for a test double.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  let baseUrl = '';

  app.get('/.well-known/openid-configuration', async () => ({
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    jwks_uri: `${baseUrl}/jwks`,
    end_session_endpoint: `${baseUrl}/end_session`,
  }));

  app.get('/jwks', async () => ({ keys: [{ ...jwk, kid: KEY_ID, alg: 'RS256', use: 'sig' }] }));

  app.post('/token', async (request, reply) => {
    const body = request.body as { code?: string };
    const outcome = body.code !== undefined ? codes.get(body.code) : undefined;
    if (!outcome) return reply.code(400).send({ error: 'invalid_grant' });
    if ('errorStatus' in outcome) return reply.code(outcome.errorStatus).send({ error: 'invalid_grant' });
    return reply.send({ id_token: outcome.idToken, access_token: 'fake-access-token', token_type: 'Bearer' });
  });

  app.get('/end_session', async (_request, reply) => reply.send('ok'));

  // Bound and addressed by the same hostname ('localhost') so the two always
  // agree — `server/auth/oidc.ts` also only accepts a non-`https:` issuer when
  // its host is exactly `localhost`, which a raw loopback IP wouldn't satisfy.
  await app.listen({ port: 0, host: 'localhost' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('fake Authentik did not bind to a port');
  baseUrl = `http://localhost:${String(address.port)}`;

  return {
    baseUrl,
    registerCode(code, outcome) {
      codes.set(code, outcome);
    },
    async mintIdToken(claims, signingKey = privateKey) {
      const now = Math.floor(Date.now() / 1000);
      return new SignJWT({
        iss: claims.iss ?? baseUrl,
        aud: claims.aud ?? clientId,
        sub: claims.sub,
        nonce: claims.nonce,
        preferred_username: claims.preferred_username,
        name: claims.name,
        iat: now,
        exp: claims.exp ?? now + 300,
      })
        .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
        .sign(signingKey);
    },
    async close() {
      await app.close();
    },
  };
}
