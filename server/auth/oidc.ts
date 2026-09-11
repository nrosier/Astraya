/**
 * Authentik OIDC (#75-#77, #136): discovery, server-side token exchange, and ID
 * token verification. The browser never sees an access, ID, or refresh token —
 * it does the top-level redirect and gets back an authorization code, which a
 * new route (`server/auth/routes.ts`) hands to this module.
 *
 * `jose` rather than a hand-rolled JWT check: signature verification, JWKS key
 * rotation, and clock-skew tolerance are exactly the kind of crypto-correctness
 * code not worth reinventing.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface OidcConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly publicUrl: string;
}

interface DiscoveryDocument {
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
  readonly end_session_endpoint?: string;
}

/**
 * Reads `ASTRAYA_OIDC_ISSUER`/`ASTRAYA_OIDC_CLIENT_ID`/`ASTRAYA_PUBLIC_URL`. `null`
 * means OIDC is disabled (unset issuer) — nothing else in this module runs, and
 * the app works exactly as it does today. A *present* issuer that isn't a valid
 * `https:` URL (or `localhost`, for local Authentik testing) is a deployment
 * mistake, not a "disabled" state, so it throws rather than silently doing nothing.
 */
export function loadOidcConfig(): OidcConfig | null {
  const issuer = process.env.ASTRAYA_OIDC_ISSUER;
  if (issuer === undefined || issuer === '') return null;

  const clientId = process.env.ASTRAYA_OIDC_CLIENT_ID;
  if (clientId === undefined || clientId === '') {
    throw new Error('ASTRAYA_OIDC_ISSUER is set but ASTRAYA_OIDC_CLIENT_ID is not.');
  }

  let issuerUrl: URL;
  try {
    issuerUrl = new URL(issuer);
  } catch {
    throw new Error(`ASTRAYA_OIDC_ISSUER must be a valid URL, got: ${issuer}`);
  }
  if (issuerUrl.protocol !== 'https:' && issuerUrl.hostname !== 'localhost') {
    throw new Error(`ASTRAYA_OIDC_ISSUER must use https: (or be localhost for local testing), got: ${issuer}`);
  }

  const publicUrl = process.env.ASTRAYA_PUBLIC_URL;
  if (publicUrl === undefined || publicUrl === '') {
    throw new Error('ASTRAYA_OIDC_ISSUER is set but ASTRAYA_PUBLIC_URL is not.');
  }
  const redirectUri = new URL('/auth/oidc/callback', publicUrl).toString();

  return { issuer: issuer.replace(/\/+$/, ''), clientId, redirectUri, publicUrl };
}

// Cached per issuer so the exchange and the logout redirect never re-fetch discovery
// per request — this module is loaded once per process, and the issuer never changes
// without a restart.
let cachedDiscovery: { readonly issuer: string; readonly promise: Promise<DiscoveryDocument> } | undefined;
let cachedJwks: { readonly issuer: string; readonly jwks: ReturnType<typeof createRemoteJWKSet> } | undefined;

async function fetchDiscovery(issuer: string): Promise<DiscoveryDocument> {
  const response = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!response.ok) {
    throw new Error(`OIDC discovery failed for ${issuer}: HTTP ${response.status}`);
  }
  return (await response.json()) as DiscoveryDocument;
}

export function getDiscovery(issuer: string): Promise<DiscoveryDocument> {
  if (cachedDiscovery?.issuer !== issuer) {
    cachedDiscovery = { issuer, promise: fetchDiscovery(issuer) };
  }
  return cachedDiscovery.promise;
}

function getJwks(issuer: string, jwksUri: string): ReturnType<typeof createRemoteJWKSet> {
  if (cachedJwks?.issuer !== issuer) {
    cachedJwks = { issuer, jwks: createRemoteJWKSet(new URL(jwksUri)) };
  }
  return cachedJwks.jwks;
}

export interface ExchangeCodeParams {
  readonly config: OidcConfig;
  readonly code: string;
  readonly codeVerifier: string;
}

/**
 * Trades an authorization code for tokens at the discovered `token_endpoint`. No
 * client secret is sent — Authentik's provider is configured as a public client,
 * per #75, so PKCE's `code_verifier` is the only proof of possession.
 */
export async function exchangeCode(params: ExchangeCodeParams): Promise<{ readonly idToken: string }> {
  const discovery = await getDiscovery(params.config.issuer);
  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.config.redirectUri,
      client_id: params.config.clientId,
      code_verifier: params.codeVerifier,
    }),
  });
  if (!response.ok) {
    throw new Error(`OIDC token exchange failed: HTTP ${response.status}`);
  }
  const body = (await response.json()) as { readonly id_token?: unknown };
  if (typeof body.id_token !== 'string') {
    throw new Error('OIDC token response did not include an id_token.');
  }
  return { idToken: body.id_token };
}

export interface VerifiedIdToken {
  readonly subject: string;
  readonly preferredUsername: string | undefined;
  readonly nonce: string | undefined;
}

/**
 * Verifies signature, issuer, audience, and expiry (with a 60s clock-skew
 * tolerance — #76's "clock-skew tolerance" requirement). The caller is
 * responsible for separately checking `nonce` against the value it generated,
 * since that's a property of *this sign-in attempt*, not of the token alone.
 */
export async function verifyIdToken(config: OidcConfig, idToken: string): Promise<VerifiedIdToken> {
  const discovery = await getDiscovery(config.issuer);
  const jwks = getJwks(config.issuer, discovery.jwks_uri);
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: config.issuer,
    audience: config.clientId,
    clockTolerance: 60,
  });
  if (typeof payload.sub !== 'string' || payload.sub === '') {
    throw new Error('OIDC ID token has no subject claim.');
  }
  return {
    subject: payload.sub,
    preferredUsername: typeof payload.preferred_username === 'string' ? payload.preferred_username : undefined,
    nonce: typeof payload.nonce === 'string' ? payload.nonce : undefined,
  };
}

/** Resolves the `end_session_endpoint` for RP-initiated logout (#77), or `undefined` if the discovery document doesn't advertise one. */
export async function getEndSessionEndpoint(issuer: string): Promise<string | undefined> {
  const discovery = await getDiscovery(issuer);
  return discovery.end_session_endpoint;
}
