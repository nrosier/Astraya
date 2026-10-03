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

export interface OidcAdminGroupCheck {
  readonly level: 'info' | 'warn';
  readonly message: string;
  /** Structured fields for the log line: the claim read, what was found, what is configured, what matched. */
  readonly fields: {
    readonly groupClaim: string;
    readonly groupsSeen: readonly string[];
    readonly adminGroupsConfigured: readonly string[];
    readonly matchedGroups: readonly string[];
  };
}

/**
 * What an OIDC sign-in's group check saw, as a log record (#414): promotion is silent by design
 * (a non-match is not an error), which made a misconfiguration — the env var never loaded, or
 * the IdP not putting `groups` in the ID token — impossible to tell apart from "nobody was in
 * the admin group". Warns exactly when admin groups are configured but the token carried none,
 * since that is the case the operator can fix; everything else is plain information.
 */
export function describeOidcAdminGroupCheck(groups: readonly string[], groupClaim: string): OidcAdminGroupCheck {
  const configured = [...loadOidcAdminGroups()];
  const matched = groups.filter((group) => configured.includes(group));
  const fields = { groupClaim, groupsSeen: groups, adminGroupsConfigured: configured, matchedGroups: matched };
  if (configured.length === 0) {
    return {
      level: 'info',
      message: 'OIDC sign-in: ASTRAYA_OIDC_ADMIN_GROUPS is not set, so no admin promotion by group is attempted.',
      fields,
    };
  }
  if (groups.length === 0) {
    return {
      level: 'warn',
      message: `OIDC sign-in: the ID token has no "${groupClaim}" claim (or it is empty), so nobody can be promoted by group. Check the provider's scope/property mapping that emits it.`,
      fields,
    };
  }
  if (matched.length === 0) {
    return {
      level: 'info',
      message: `OIDC sign-in: none of the user's groups (${groups.join(', ')}) is in ASTRAYA_OIDC_ADMIN_GROUPS (${configured.join(', ')}); group names are matched exactly, case included.`,
      fields,
    };
  }
  return {
    level: 'info',
    message: `OIDC sign-in: matched admin group ${matched.join(', ')}.`,
    fields,
  };
}

export interface StartupNotice {
  readonly level: 'info' | 'warn';
  readonly message: string;
}

/** The one-time startup note about `ASTRAYA_OIDC_ADMIN_GROUPS` (#414), or `undefined` when there is nothing worth saying. */
export function adminGroupStartupNotice(oidcEnabled: boolean, groupClaim: string): StartupNotice | undefined {
  const configured = [...loadOidcAdminGroups()];
  if (configured.length > 0 && !oidcEnabled) {
    return {
      level: 'warn',
      message:
        'ASTRAYA_OIDC_ADMIN_GROUPS is set but OIDC is not configured (ASTRAYA_OIDC_ISSUER is empty), so it has no effect. ' +
        'Note the server reads only the process environment: a .env file is used only if it is loaded, e.g. `node --env-file=.env server/index.ts`.',
    };
  }
  if (configured.length > 0) {
    return {
      level: 'info',
      message: `OIDC admin promotion: members of ${configured.join(', ')} (read from the "${groupClaim}" claim) are made admin at sign-in.`,
    };
  }
  if (oidcEnabled) {
    return {
      level: 'info',
      message: 'OIDC is enabled but ASTRAYA_OIDC_ADMIN_GROUPS is not set: nobody is promoted to admin by group.',
    };
  }
  return undefined;
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
