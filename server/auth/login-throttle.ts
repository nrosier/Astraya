/**
 * Per-account login throttling. `@fastify/rate-limit` on the route covers
 * per-address (one client hammering the endpoint); this covers the other half
 * of #133's requirement — many addresses trying the same account, which a
 * per-IP limiter alone would never notice.
 *
 * In-memory and per-process, matching the bootstrap token's own trust model: a
 * self-hosted single instance, not a fleet needing a shared store.
 */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

interface Attempts {
  count: number;
  windowStart: number;
}

const attemptsByUsername = new Map<string, Attempts>();

/** Case-insensitive, matching `users.username`'s own `COLLATE NOCASE`. */
function key(username: string): string {
  return username.toLowerCase();
}

/**
 * Without this, an attacker cycling through never-real usernames grows this map
 * forever — each one is only ever cleared lazily, on a later read of that *same*
 * username, which an attacker never makes twice (#317). Sweeping on a timer bounds
 * the map to roughly one window's worth of real attempts, without changing what
 * `isLoginThrottled`/`recordFailedLogin` do on the read/write path.
 */
function sweepExpiredAttempts(): void {
  const now = Date.now();
  for (const [k, entry] of attemptsByUsername) {
    if (now - entry.windowStart > WINDOW_MS) attemptsByUsername.delete(k);
  }
}

// unref: a periodic cleanup timer must not be a reason the process (or a test runner
// importing this module) stays alive.
setInterval(sweepExpiredAttempts, WINDOW_MS).unref();

export function isLoginThrottled(username: string): boolean {
  const entry = attemptsByUsername.get(key(username));
  if (!entry) return false;
  if (Date.now() - entry.windowStart > WINDOW_MS) {
    attemptsByUsername.delete(key(username));
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function recordFailedLogin(username: string): void {
  const k = key(username);
  const entry = attemptsByUsername.get(k);
  if (!entry || Date.now() - entry.windowStart > WINDOW_MS) {
    attemptsByUsername.set(k, { count: 1, windowStart: Date.now() });
    return;
  }
  entry.count += 1;
}

export function clearLoginThrottle(username: string): void {
  attemptsByUsername.delete(key(username));
}
