/**
 * PKCE state for the Authentik redirect round-trip (#75). This is scratch data
 * for a single sign-in attempt — never a token, never anything durable — so
 * `sessionStorage` (gone when the tab closes) is the right home for it, not
 * IndexedDB.
 */

const PENDING_KEY = 'astraya:oidcPending';

/**
 * A fixed, real path (not a hash route) so the server's SPA fallback
 * (`server/index.ts`) serves `index.html` here, and so it's the exact value
 * documented in `.env.example` for what to register as the Authentik
 * provider's redirect URI.
 */
export const OIDC_CALLBACK_PATH = '/auth/oidc/callback';

interface PendingOidc {
  readonly state: string;
  readonly codeVerifier: string;
  readonly nonce: string;
}

function base64Url(buffer: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function randomToken(bytes: number): string {
  const array = new Uint8Array(bytes);
  crypto.getRandomValues(array);
  return base64Url(array.buffer);
}

async function codeChallengeFor(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return base64Url(digest);
}

/**
 * Generates and stashes PKCE `state`/`nonce`/`code_verifier`, returning what
 * the authorization request needs. Called once, right before the top-level
 * navigation to Authentik.
 */
export async function startOidcHandshake(): Promise<{
  readonly state: string;
  readonly nonce: string;
  readonly codeChallenge: string;
  readonly redirectUri: string;
}> {
  const state = randomToken(24);
  const nonce = randomToken(24);
  const codeVerifier = randomToken(32);
  const codeChallenge = await codeChallengeFor(codeVerifier);
  const pending: PendingOidc = { state, codeVerifier, nonce };
  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  const redirectUri = new URL(OIDC_CALLBACK_PATH, window.location.origin).toString();
  return { state, nonce, codeChallenge, redirectUri };
}

/**
 * Called once at boot, before anything else acts on the URL. `undefined`
 * unless `location.pathname` is the callback path AND the returned `state`
 * matches what `startOidcHandshake` stashed — including on a replay, since
 * the pending entry is consumed (removed) either way. Always clears the
 * callback path from the URL via `replaceState`, so a page reload can never
 * resubmit the one-time authorization code.
 */
export function consumeOidcCallback():
  { readonly code: string; readonly codeVerifier: string; readonly nonce: string } | undefined {
  if (window.location.pathname !== OIDC_CALLBACK_PATH) return undefined;

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const raw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  history.replaceState(null, '', '/');

  if (code === null || state === null || raw === null) return undefined;
  const pending = JSON.parse(raw) as PendingOidc;
  if (state !== pending.state) return undefined;
  return { code, codeVerifier: pending.codeVerifier, nonce: pending.nonce };
}
