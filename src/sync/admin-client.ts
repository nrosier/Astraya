/**
 * Thin `fetch()` wrappers matching `server/auth/admin-routes.ts` exactly, one function
 * per route. Same shape as `auth-client.ts`: nothing here interprets a response beyond
 * its own shape, and every rejection carries the server's own message.
 */

/** Mirrors `server/auth/admin-routes.ts`'s `AdminUser` shape. */
export interface AdminUser {
  readonly id: string;
  readonly username: string;
  readonly isAdmin: boolean;
  readonly createdAt: string;
  readonly disabledAt: string | null;
  readonly lastSeenAt: string | null;
}

/** Mirrors `server/ops/deletion-impact.ts`'s `DeletionImpact`. */
export type DeletionImpact =
  | { readonly kind: 'counted'; readonly people: number; readonly charts: number }
  | { readonly kind: 'approximate'; readonly opRows: number };

/** Thrown for a request the server actively rejected (not an admin, last-admin guard, ...). */
export class AdminError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AdminError';
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

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new AdminError(await errorMessage(response), response.status);
  return (await response.json()) as T;
}

export async function listUsers(): Promise<readonly AdminUser[]> {
  const { users } = await call<{ users: readonly AdminUser[] }>('/api/admin/users');
  return users;
}

export async function createUser(
  username: string,
  isAdmin?: boolean,
): Promise<{ user: AdminUser; setPasswordUrl: string }> {
  return call('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(isAdmin === undefined ? { username } : { username, isAdmin }),
  });
}

export async function resetPassword(id: string): Promise<{ user: AdminUser; setPasswordUrl: string }> {
  return call(`/api/admin/users/${id}/reset-password`, { method: 'POST' });
}

export async function disableUser(id: string): Promise<AdminUser> {
  const { user } = await call<{ user: AdminUser }>(`/api/admin/users/${id}/disable`, { method: 'POST' });
  return user;
}

export async function enableUser(id: string): Promise<AdminUser> {
  const { user } = await call<{ user: AdminUser }>(`/api/admin/users/${id}/enable`, { method: 'POST' });
  return user;
}

export async function promoteUser(id: string): Promise<AdminUser> {
  const { user } = await call<{ user: AdminUser }>(`/api/admin/users/${id}/promote`, { method: 'POST' });
  return user;
}

export async function demoteUser(id: string): Promise<AdminUser> {
  const { user } = await call<{ user: AdminUser }>(`/api/admin/users/${id}/demote`, { method: 'POST' });
  return user;
}

export async function getDeletionImpact(id: string): Promise<DeletionImpact> {
  return call(`/api/admin/users/${id}/deletion-impact`);
}

export async function deleteUser(id: string): Promise<void> {
  await call(`/api/admin/users/${id}`, { method: 'DELETE' });
}
