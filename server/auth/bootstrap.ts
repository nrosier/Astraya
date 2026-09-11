/**
 * Creating the first admin account: the single most security-sensitive moment in
 * a deployment, because every mechanism for doing it is also a mechanism for
 * someone else to do it.
 *
 * Deliberately not done via a default credential (found by scanners within hours)
 * or an admin created unconditionally from env vars (an operator can't tell
 * whether the account they're looking at is the one they created). Instead: a
 * one-time token, printed to the server log, readable only by whoever already has
 * the same access as running the container — which is the property that makes it
 * safe to be unauthenticated over the network.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db.ts';

const TOKEN_TTL_MS = 15 * 60 * 1000;

interface BootstrapToken {
  readonly token: string;
  /** `null` for the env-supplied token: it doesn't expire on its own, only when an admin exists. */
  readonly expiresAt: number | null;
  readonly fromEnv: boolean;
}

/** Held in memory only, for exactly this process's lifetime. A restart invalidates it on purpose. */
let current: BootstrapToken | null = null;

export function adminExists(db: Database): boolean {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get() as { count: number };
  return row.count > 0;
}

/**
 * Call once at server startup. Logs the bootstrap URL on every boot while no
 * admin exists yet — an un-bootstrapped instance is a misconfiguration, not a
 * steady state, so this doesn't log once and go quiet.
 */
export function announceBootstrap(db: Database, log: FastifyBaseLogger): void {
  if (adminExists(db)) {
    current = null;
    return;
  }
  const envToken = process.env.ASTRAYA_BOOTSTRAP_TOKEN;
  if (envToken) {
    current = { token: envToken, expiresAt: null, fromEnv: true };
    log.warn('No admin account exists. Using the configured ASTRAYA_BOOTSTRAP_TOKEN — create one at POST /api/setup');
    return;
  }
  current = { token: randomBytes(48).toString('base64url'), expiresAt: Date.now() + TOKEN_TTL_MS, fromEnv: false };
  log.warn(`No admin account exists. Create one within 15 minutes at: /setup?token=${current.token}`);
}

export type BootstrapTokenError = 'no-token-issued' | 'invalid' | 'expired';

/** Checked by the `/setup` route before it looks at the submitted password at all. */
export function checkBootstrapToken(submitted: string): BootstrapTokenError | null {
  if (!current) return 'no-token-issued';
  if (submitted !== current.token) return 'invalid';
  if (current.expiresAt !== null && Date.now() > current.expiresAt) return 'expired';
  return null;
}
