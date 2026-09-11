/**
 * The client's only `fetch()` call: a thin wrapper matching `server/auth/routes.ts`
 * exactly. Nothing here interprets the response beyond its shape — the server is the
 * one place that decides who is signed in.
 */

/** Mirrors `server/auth/identity.ts`'s `User` shape. */
export interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly isAdmin: boolean;
  readonly createdAt: string;
  readonly disabledAt: string | null;
}

/** Thrown for a request the server actively rejected (bad credentials, rate limit, ...). */
export class AuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuthError';
    this.status = status;
  }
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    /* fall through to the generic message below */
  }
  return `Request failed with status ${String(response.status)}`;
}

/** `POST /api/auth/login`. Throws `AuthError` on 400/401/429 with the server's own message. */
export async function login(username: string, password: string): Promise<AuthUser> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new AuthError(await errorMessage(response), response.status);
  const { user } = (await response.json()) as { user: AuthUser };
  return user;
}

/** `POST /api/auth/logout`. Always succeeds — there is no session left to reject the request. */
export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}

/**
 * `GET /api/auth/me`. `undefined` means "not signed in" (401) — an ordinary, expected
 * outcome, not a failure. Anything else that goes wrong (network down, 5xx) throws, so a
 * caller can tell "signed out" apart from "couldn't ask".
 */
export async function me(): Promise<AuthUser | undefined> {
  const response = await fetch('/api/auth/me');
  if (response.status === 401) return undefined;
  if (!response.ok) throw new AuthError(await errorMessage(response), response.status);
  const { user } = (await response.json()) as { user: AuthUser };
  return user;
}
