/**
 * Origin checking, as defence in depth behind `SameSite=Lax` (#329).
 *
 * Cross-site request forgery is already blocked twice over: the session cookie is
 * `sameSite: 'lax'`, which suppresses it on any cross-site write, and Fastify's default
 * body parser rejects `application/x-www-form-urlencoded`, which is the only body type a
 * plain HTML form can send. Both of those are good defences. Neither is *ours*: the first
 * is the browser's promise and the second is a library default that a future content-type
 * parser could quietly widen. This module is the check that does not depend on either.
 *
 * Deliberately not a CSRF token. A token needs somewhere to live, which for a local-first
 * app with no server-rendered HTML means another cookie plus a header on every write, and
 * it would protect exactly the requests an origin check already protects. The cost is not
 * the code, it is the extra piece of session state that can desynchronise and lock a
 * signed-in user out of their own data.
 *
 * **Absent `Origin` is allowed.** Browsers omit it on same-origin navigations, and `curl`
 * and the test suite never send it, so requiring it would reject legitimate clients while
 * adding nothing: the attack this guards against is a *browser* making a cross-site write,
 * and browsers always send `Origin` on a write.
 */

/**
 * Methods that can change state. A `GET` is not on this list even though
 * `/api/admin/users/:id/deletion-impact` used to be one — Lax permits cookies on a
 * cross-site top-level navigation, so that route became a `POST` instead of being special-
 * cased here. Keeping the rule "writes use a write method" is what makes this list short
 * enough to trust.
 */
const UNSAFE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface OriginCheck {
  readonly method: string;
  /** The request's `Origin` header, if it sent one. */
  readonly origin: string | undefined;
  /** Hosts this deployment answers as — its own `Host`, plus `ASTRAYA_PUBLIC_URL`'s when set. */
  readonly allowedHosts: readonly string[];
}

/**
 * Should this request be refused as a cross-origin write?
 *
 * Compares hosts rather than whole origins, which is the one place this deviates from the
 * textbook check, and does so for a deployment reason: a TLS-terminating proxy that
 * forwards without `X-Forwarded-Proto` makes the server see `http` for a page the browser
 * loaded over `https`, and a scheme-sensitive comparison would then 403 every write in a
 * perfectly ordinary setup. The host is the part that actually distinguishes this site
 * from an attacker's, so it is the part compared.
 */
export function isCrossOriginWrite({ method, origin, allowedHosts }: OriginCheck): boolean {
  if (!UNSAFE_METHODS.has(method.toUpperCase())) return false;
  if (origin === undefined) return false;
  // An opaque origin arrives as the literal string `null` (a sandboxed iframe, a
  // `file://` page), which `URL.parse` cannot read — and which no legitimate client of
  // this server has. Unreadable means refused, not allowed.
  const host = URL.parse(origin)?.host;
  return host === undefined || !allowedHosts.includes(host);
}
