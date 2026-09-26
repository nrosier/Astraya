/**
 * Promote-only admin auto-promotion (#292): an env-configured username
 * allowlist for local accounts, and an OIDC group claim for SSO accounts.
 * Deliberately promote-only — removing a name from the allowlist, or a group
 * from the IdP side, never auto-demotes anyone. Demotion stays the existing
 * manual action (`server/auth/admin-routes.ts`'s Demote route, #135), which
 * avoids a surprise lockout from an env-var typo or an IdP group rename, and
 * means `isOnlyRemainingAdmin` (`admin-routes.ts:65-70`) — which only fires on
 * demote/disable/delete — is structurally unreachable from this module: there
 * is no path here that ever removes admin from anyone.
 */
import type { Database } from '../db.ts';
import type { User } from './identity.ts';

/** `ASTRAYA_ADMIN_USERNAMES`, comma-separated, matched case-insensitively — mirrors `users.username`'s `COLLATE NOCASE`. */
export function loadAdminUsernameAllowlist(): ReadonlySet<string> {
  const raw = process.env.ASTRAYA_ADMIN_USERNAMES ?? '';
  return new Set(
    raw
      .split(',')
      .map((name) => name.trim().toLowerCase())
      .filter((name) => name !== ''),
  );
}

/** `ASTRAYA_OIDC_ADMIN_GROUPS`, comma-separated, matched exactly — IdP group names are identifiers, so case matters. */
export function loadOidcAdminGroups(): ReadonlySet<string> {
  const raw = process.env.ASTRAYA_OIDC_ADMIN_GROUPS ?? '';
  return new Set(
    raw
      .split(',')
      .map((group) => group.trim())
      .filter((group) => group !== ''),
  );
}

function grantAdmin(db: Database, user: User): User {
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ? AND is_admin = 0').run(user.id);
  return { ...user, isAdmin: true };
}

/** Promotes `user` if `username` is on `ASTRAYA_ADMIN_USERNAMES`. A no-op (returns `user` unchanged) if already admin or not allowlisted. */
export function promoteLocalUserIfAllowlisted(db: Database, user: User, username: string): User {
  if (user.isAdmin) return user;
  const allowlist = loadAdminUsernameAllowlist();
  if (allowlist.size === 0) return user;
  if (!allowlist.has(username.toLowerCase())) return user;
  return grantAdmin(db, user);
}

/** Promotes `user` if any of `groups` is on `ASTRAYA_OIDC_ADMIN_GROUPS`. A no-op (returns `user` unchanged) if already admin or no group matches. */
export function promoteOidcUserIfGroupMatched(db: Database, user: User, groups: readonly string[]): User {
  if (user.isAdmin) return user;
  const adminGroups = loadOidcAdminGroups();
  if (adminGroups.size === 0) return user;
  if (!groups.some((group) => adminGroups.has(group))) return user;
  return grantAdmin(db, user);
}
