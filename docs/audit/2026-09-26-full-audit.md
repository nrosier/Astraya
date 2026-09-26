# Astraya full codebase audit — 2026-09-26

**Scope:** `src/` (React 19 + TS frontend, ~28.6k LoC TS/TSX), `server/` (Fastify + `node:sqlite`),
`e2e/`, `test/`, build config. Read against ADR 0001 (Swiss Ephemeris as the engine) and
ADR 0002 (local-first with optional sync).

**Method:** files were opened and read, not skimmed. Every finding cites a file and line. Each
finding is labelled **[CONFIRMED]** (the code was read and the problem verified by reading the
control flow) or **[SUSPECTED]** (looks wrong, but a full trace or a runtime reproduction was not
done). Findings are ranked by severity within each section.

**Baseline quality note, so the findings below are read in proportion:** this is an unusually
well-engineered codebase. `tsconfig.app.json` runs `strict` + `noUncheckedIndexedAccess` +
`exactOptionalPropertyTypes`; ESLint runs `strictTypeChecked` and mechanically enforces the
`sweph-wasm` and `tools/` import boundaries (`eslint.config.js:39-64`); there are **zero** `any`
casts in `src/` or `server/`; 1,508 tests; `npm audit --omit=dev` reports 0 vulnerabilities; the
Docker image runs as UID 1000 (`Dockerfile:100`). There is no generic best-practice padding in
this report — everything below is tied to a specific line.

---

## Executive summary — the 10 findings worth acting on first

| #   | Finding                                                                                                                                                                                                       | Dimension         | Severity        | Status    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------- | --------- |
| 1   | "Delete permanently" (`purge`) never reaches the server or peers. Purged birth data stays in `ops` forever and resurrects on every other device.                                                              | Privacy / data    | **Critical**    | CONFIRMED |
| 2   | Birth coordinates and place names are sent to third parties (Nominatim / MapTiler / OSM tiles) by default, contradicting the in-code guarantee "Birth data never leaves the browser".                         | Privacy           | **High**        | CONFIRMED |
| 3   | Two browser tabs share one `deviceId` but hold independent clocks, so they can mint identical HLCs for different operations → silent overwrite in IndexedDB.                                                  | Data loss         | **High**        | CONFIRMED |
| 4   | A single clock-skewed operation permanently wedges push for that device — no quarantine path, and every later edit is blocked behind it.                                                                      | Data loss         | **High**        | CONFIRMED |
| 5   | `trustProxy: true` is unconditional, so `X-Forwarded-For` spoofing defeats all per-IP rate limiting; and `/api/setup`, `/api/auth/set-password`, `/api/ops` and all `/api/admin/*` have no rate limit at all. | Security          | **High**        | CONFIRMED |
| 6   | The OIDC authorization code is persisted into Cache Storage by the service worker _and_ written to the server request log.                                                                                    | Security          | **Medium-High** | CONFIRMED |
| 7   | Setting `ASTRAYA_GEOCODE_ORIGIN` alone does not strip the CSP `<meta>` tag, so the stricter meta policy blocks the very geocoder the header permits.                                                          | Security / config | **Medium**      | CONFIRMED |
| 8   | `handleUnauthorized` leaves the previous account's store open and writable while the UI renders as signed-out → cross-account write.                                                                          | Privacy           | **Medium-High** | CONFIRMED |
| 9   | Eleven independent `WorkerEphemerisProvider` sites; `ChartView` holds three concurrent WASM workers (~2.5 MB ephemeris data each), and any unrelated store change re-triggers a full chart recompute.         | Performance       | **Medium-High** | CONFIRMED |
| 10  | `getDiscovery` caches a _rejected_ promise for the process lifetime — one transient network failure disables OIDC until restart.                                                                              | Availability      | **Medium**      | CONFIRMED |

---

## 1. Security

### 1.1 `trustProxy: true` is unconditional, defeating per-IP rate limiting — **High** — [CONFIRMED]

`server/index.ts:51`

```ts
trustProxy: true,
```

`@fastify/rate-limit` keys by `request.ip`. With `trustProxy: true` and no allow-list of trusted
proxy addresses, `request.ip` becomes the left-most value of a client-supplied `X-Forwarded-For`
header. An attacker who can reach the server directly (or whose proxy forwards the header
verbatim) rotates that header per request and the limiter never fires.

Concretely this removes the only per-address control on `/api/auth/login`
(`server/auth/routes.ts:57`, `max: 20, timeWindow: '1 minute'`) and
`/api/auth/oidc/callback` (`server/auth/routes.ts:145`).

Also note the same header feeds `request.protocol`, which decides the `Secure` cookie flag:

`server/auth/routes.ts:26-28`

```ts
function isSecureRequest(request: { protocol: string }): boolean {
  return request.protocol === 'https';
}
```

A request arriving with `X-Forwarded-Proto: http` gets a session cookie minted **without**
`Secure` (`routes.ts:84`, `:182`, `:229`). This is a secondary concern — it needs an attacker who
can already authenticate — but it means the cookie's transport protection is attacker-influenced.

_Remedy:_ replace `trustProxy: true` with the specific proxy CIDR or hop count
(`trustProxy: '10.0.0.0/8'` / `trustProxy: 1`), and derive `secure` from a deployment config value
(`ASTRAYA_PUBLIC_URL`'s scheme) rather than from the request.

### 1.2 Four unauthenticated or state-changing route groups have no rate limit — **High** — [CONFIRMED]

`server/index.ts:77` registers the limiter with `global: false`:

```ts
await app.register(fastifyRateLimit, { global: false });
```

so **only** routes carrying an explicit `config.rateLimit` are limited. Exactly two do. The
following are unlimited:

| Route                                                       | Auth    | Why it matters                                                                  |
| ----------------------------------------------------------- | ------- | ------------------------------------------------------------------------------- |
| `POST /api/setup` (`server/auth/routes.ts:194`)             | none    | Unthrottled brute force of the bootstrap token.                                 |
| `POST /api/auth/set-password` (`server/auth/routes.ts:239`) | none    | Unthrottled brute force of the 7-day password-set token (`admin-routes.ts:20`). |
| `POST /api/ops` (`server/ops/routes.ts:72`)                 | session | No per-user write quota anywhere — one account can fill the volume (see 3.5).   |
| All `/api/admin/*` (`server/auth/admin-routes.ts:93-219`)   | admin   | `GET .../deletion-impact` decrypts every op row for a user; see 5.5.            |

The tokens themselves are 48 random bytes (`bootstrap.ts:50`, `admin-routes.ts:73`), so guessing is
not a practical threat _for the generated ones_. The gap that matters is
`ASTRAYA_BOOTSTRAP_TOKEN`: an operator-supplied value with **no entropy floor and no expiry**
(`bootstrap.ts:44-48`, `expiresAt: null`), guessable at unlimited rate until an admin exists.

_Remedy:_ add `config.rateLimit` to all four groups; enforce a minimum length on
`ASTRAYA_BOOTSTRAP_TOKEN` at load time.

### 1.3 Username is never length-bounded; the login throttle map grows without bound — **Medium** — [CONFIRMED]

`server/auth/login-throttle.ts:18`

```ts
const attemptsByUsername = new Map<string, Attempts>();
```

`recordFailedLogin(username)` (`routes.ts:75`) inserts an entry keyed by the _submitted_ username.
Entries are only ever removed lazily, on a later lookup of the **same** key (`login-throttle.ts:29`)
or on a successful login (`:46`). A caller sending one login attempt per distinct random username
adds a permanent Map entry each time. Combined with 1.1 (no effective per-IP cap), this is an
unbounded-memory DoS on a long-lived process.

Compounding it: **no route validates a maximum username length.** `routes.ts:60` checks only
`typeof username !== 'string' || username === ''`; `admin-routes.ts:112` and `:207` likewise. So
each map key can be megabytes, and `users.username` accepts arbitrarily long values.

_Remedy:_ cap username length (e.g. 64) at every entry point; bound the throttle map (LRU or a
periodic sweep).

### 1.4 `checkBootstrapToken` uses a non-constant-time comparison — **Low** — [CONFIRMED]

`server/auth/bootstrap.ts:63`

```ts
if (submitted !== current.token) return 'invalid';
```

`===`/`!==` on strings short-circuits on first differing byte. Over HTTP the signal is almost
certainly unusable, and the generated token has 384 bits of entropy — but this is the one
credential comparison in the codebase that does not go through Argon2's own constant-time verify,
and `node:crypto.timingSafeEqual` is a one-line change. The same applies to the password-set token
lookup, which is a SQL equality (`identity.ts:104`) — also not constant time, though a database
index lookup is a much noisier channel.

### 1.5 `isOnlyRemainingAdmin` counts disabled admins, so the instance can be locked out — **Medium** — [CONFIRMED]

`server/auth/admin-routes.ts:65-70`

```ts
function isOnlyRemainingAdmin(db: Database, userId: string): boolean {
  const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as { is_admin: number } | undefined;
  if (!row || row.is_admin === 0) return false;
  const count = db.prepare('SELECT COUNT(*) AS count FROM users WHERE is_admin = 1').get() as { count: number };
  return count.count <= 1;
}
```

The `COUNT(*)` has no `AND disabled_at IS NULL`. Sequence: admin A is disabled (allowed, because B
exists), then admin B is deleted or demoted — the guard sees `count = 2`, returns `false`, and
permits it. The instance now has one admin row, disabled, which `resolveUser` refuses
(`identity.ts:132`). There is no recovery through the UI: `announceBootstrap` also counts
`is_admin = 1` without a `disabled_at` filter (`bootstrap.ts:30`), so it reports an admin exists and
never re-issues a bootstrap token.

This is a self-inflicted lockout rather than an attack, but it is unrecoverable without direct
database access. Note `isOnlyRemainingAdmin` is correctly applied to `disable`/`demote`/`delete`
(`:150`, `:187`, `:212`) — the predicate itself is the defect.

_Remedy:_ `WHERE is_admin = 1 AND disabled_at IS NULL` in both queries.

### 1.6 The OIDC authorization code is durably persisted twice — **Medium-High** — [CONFIRMED]

**(a) Into Cache Storage, by the service worker.** The redirect URI is a real path, not a hash
route (`src/ui/oidc-pkce.ts:16`, `OIDC_CALLBACK_PATH = '/auth/oidc/callback'`), so the browser
performs a same-origin GET navigation to `/auth/oidc/callback?code=…&state=…`. `classify` sends any
same-origin GET navigation to `shell-navigate` (`src/pwa/routing.ts:33`):

```ts
if (request.mode === 'navigate') return 'shell-navigate';
```

which dispatches to `staleWhileRevalidate` (`src/pwa/sw-core.ts:129`), and that writes
`cache.put(request, response.clone())` (`src/pwa/strategies.ts:62`) keyed by the **full request URL
including the query string**. The authorization code therefore lands in the on-disk
`astraya-shell-<version>` cache. Codes are single-use and short-lived, so exposure is bounded, but
a credential should not be written to a durable cache at all.

**(b) Into the server log.** `server/index.ts:49` configures the logger with no `redact` and no
request serializer:

```ts
logger: { level: process.env.LOG_LEVEL ?? 'info' },
```

Fastify's default `info`-level request log includes `req.url`. The callback navigation is served by
`setNotFoundHandler` (`server/index.ts:134-143`), so the full URL — code and state — is logged.

_Remedy:_ return `'bypass'` from `classify` for the callback path (or add `ignoreSearch`/a query
guard to the navigate branch), and add `logger.redact` / a `req` serializer that strips
`code`/`state`/`token` query parameters.

### 1.7 Setting `ASTRAYA_GEOCODE_ORIGIN` alone leaves a contradictory CSP in place — **Medium** — [CONFIRMED]

`server/csp.ts` correctly rewrites `connect-src` for a custom geocode origin
(`csp.ts:122-124`), and `server/index.ts:70-74` passes it through. But the two routes that strip the
static `<meta>` policy from `index.html` do **not** consider it:

`server/index.ts:123`

```ts
if (oidcConfig || tileOrigin) {
  app.get('/', async (_request, reply) => {
    /* stripped copy */
  });
}
```

`server/index.ts:136`

```ts
if (oidcConfig) {
  return reply; /* stripped copy */
}
```

So with only `ASTRAYA_GEOCODE_ORIGIN` set, `index.html` is served **with** its meta tag, which still
carries the default `https://nominatim.openstreetmap.org`. Per CSP's "all policies apply" rule —
documented correctly at `csp.ts:140-149` — the stricter meta policy wins and every request to the
self-hosted geocoder is blocked. The deployer sees geocoding silently fail with a correct-looking
header.

A second, narrower instance of the same gap: the `notFoundHandler` branch (`:136`) omits
`tileOrigin`, so on a deployment served under a non-root `VITE_BASE_PATH` (where the exact `/` route
never matches), a custom tile origin is blocked the same way.

`test/csp.test.ts` exercises `buildCsp` and `stripCspMeta` in isolation only; no test wires
`ASTRAYA_GEOCODE_ORIGIN`/`ASTRAYA_TILE_ORIGIN` through `build()` and asserts on the served HTML.

_Remedy:_ `if (oidcConfig || tileOrigin || geocodeOrigin)` at both sites, and a server test that
asserts the served `index.html` has no meta tag whenever any override is configured.

### 1.8 `getDiscovery` caches a rejected promise forever — **Medium** — [CONFIRMED]

`server/auth/oidc.ts:76-81`

```ts
export function getDiscovery(issuer: string): Promise<DiscoveryDocument> {
  if (cachedDiscovery?.issuer !== issuer) {
    cachedDiscovery = { issuer, promise: fetchDiscovery(issuer) };
  }
  return cachedDiscovery.promise;
}
```

The cache key is the issuer, and the issuer never changes. If the very first `fetchDiscovery` call
rejects — Authentik still booting, a DNS blip — the rejected promise is cached and returned for the
process lifetime. Every subsequent sign-in fails, and `/api/auth/oidc/config` reports
`{ enabled: false }` (`routes.ts:132-134`) because it swallows the error — so the UI stops offering
OIDC at all, with no log line saying why. Only a restart recovers.

_Remedy:_ clear the cache entry in a `.catch` before rethrowing, and log at `error` in
`/api/auth/oidc/config`'s catch instead of silently downgrading.

### 1.9 Injection, XSS and deserialization — **Low, mostly clean** — [CONFIRMED]

Genuinely good, with two specific residual notes.

_SQL:_ every query in `server/` uses `db.prepare(...)` with bound parameters. The only string
interpolation into SQL is `PRAGMA user_version = ${version}` (`server/db.ts:155`), where `version`
is the module's own loop counter — correctly reasoned about in the comment at `:153-154`. No
injection surface found.

_Command execution:_ no `child_process`, `exec`, or `spawn` anywhere in `src/` or `server/`.

_`eval`:_ none. CSP is `script-src 'self' 'wasm-unsafe-eval'` (`csp.ts:52`), and
`test/csp.test.ts:47` asserts `'unsafe-eval'` never appears. `src/ephemeris/worker.ts:24-65`
deliberately uses an exhaustive `switch` rather than `engine[request.method](...)`, with the
reasoning written down — that closes a real dynamic-dispatch hole.

_`dangerouslySetInnerHTML`:_ five call sites (`ChartView.tsx:530`, `TransitView.tsx:200`,
`AstrocartographyView.tsx:339`, `SynastryView.tsx:208`, plus `AstroChartWheel.tsx:45,49` using
`innerHTML = ''`). All inject SVG this app generated. The two paths that carry user-controlled text
into that SVG both escape it:

- `src/chart/chart-sheet.ts:91` — `escapeXml(metaLine)` (person name, place, notes)
- `src/chart/multi-wheel.ts:516` — `escapeXml(ring.label)`

**Residual risk [SUSPECTED]:** `escapeXml` (`src/chart/svg-primitives.ts:58-60`) escapes only
`&`, `<`, `>` — **not** `"` or `'`:

```ts
export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
```

That is sufficient for the two current uses, which are both text-node content. It is not sufficient
for an attribute, and every builder in that file interpolates into double-quoted attributes
(`line`, `circle`, `rect`, `polygon`, `text`'s `class=`). The first time someone passes a
user-controlled string as a `className` or a `<title>` attribute, this becomes an XSS in a
`dangerouslySetInnerHTML` sink. Escape quotes now, while it is a two-character change.

_Deserialization:_ `src/ui/markdown.tsx` is a hand-rolled renderer that cannot emit raw HTML and
rejects non-`http(s)`/hash hrefs after resolution (`markdown.tsx:43-56`) — correct, including the
ordering. `JSON.parse` sites all feed validated decoders (`store/ops.ts:215`, `store/db.ts:184`,
`domain/chart-share.ts:102`) except one — see 4.4.

### 1.10 CSRF: adequately mitigated, but only by one mechanism — **Low** — [CONFIRMED]

All state-changing routes are `POST`/`DELETE` with `Content-Type: application/json`, and the session
cookie is `sameSite: 'lax'` (`routes.ts:83`, `:181`, `:228`). Lax suppresses the cookie on
cross-site `POST`, and Fastify's default body parser rejects `application/x-www-form-urlencoded`
(415), so a classic form-based CSRF fails twice over. There is **no** CSRF token and **no**
`Origin`/`Referer` check — so the whole defence rests on the browser honouring `SameSite`.

One route is worth naming: `GET /api/admin/users/:id/deletion-impact`
(`admin-routes.ts:195`) _is_ reachable with cookies on a cross-site top-level navigation, because
Lax permits exactly that. An attacker cannot read the JSON response, but they can force an admin's
browser to trigger a full decrypt of another user's entire operation log (see 5.5). Prefer `POST`
for it, or add an `Origin` check.

### 1.11 Secrets handling — **Low, well documented** — [CONFIRMED]

- `.gitignore:26,29-31` covers `.env`, `.env.*` (with `!.env.example`) and `*.local`;
  `git ls-files` confirms only `.env.example` is tracked. `.env.local` is present on disk and
  correctly ignored.
- `ASTRAYA_ENCRYPTION_KEY` is validated to exactly 32 bytes and throws on a wrong length rather
  than silently proceeding (`server/ops/crypto.ts:59-67`). The "key and database must be backed up
  separately" constraint is written into both `.gitignore:19-21` and ADR 0002.
- `GEMINI_API_KEY` is deliberately **not** `VITE_`-prefixed (`.env.example:43-45`), and
  `test/no-runtime-llm-access.test.ts` plus the `tools/**` import ban
  (`eslint.config.js:52-57`) enforce that no model client can reach the bundle. This is a
  genuinely strong control.
- `VITE_MAPTILER_API_KEY` **is** baked into the client bundle (`geocode-provider.ts:28-30`,
  `maptilerGeocodeUrl` at `:39-43` puts it in a query string). This is inherent to browser-side
  tile/geocode usage and is documented at `.env.example:115-117`. Worth restating in the README as
  an operational requirement: restrict the key by referrer/domain in the MapTiler console, because
  it is public by construction.

### 1.12 Authorization checks — **no gaps found** — [CONFIRMED]

Every admin route carries `preHandler: requireAdmin(db)` (`admin-routes.ts:93,106,135,146,161,172,
183,197,208`) — verified individually, none missing. Both ops routes carry `requireUser(db)`
(`ops/routes.ts:72`, `:134`), and both scope every query by `user.id`
(`:110`, `:148`) — no IDOR path found. `authenticatedUser` (`ops/routes.ts:57-60`) throws rather
than defaulting if the preHandler did not run, which is the right failure direction.

Two stale doc comments to fix while you are in there: `identity.ts:145-147` claims `requireUser` is
"not applied to any route yet" (it guards both ops routes), and `store.ts:112-115` claims sync
does not exist yet.

### 1.13 Session handling — **sound by design** — [CONFIRMED]

Server-side session rows rather than stateless JWTs (`sessions.ts:1-9`), so revocation is immediate
— and `resolveUser` re-checks `disabledAt` on every request (`identity.ts:132`) in addition to
`revokeAllSessionsForUser` on disable (`admin-routes.ts:154`). Login mints a fresh `randomUUID`
session (`sessions.ts:50`), so fixation is not possible. Argon2id with library defaults, with the
reasoning for not re-specifying them written down (`passwords.ts:1-12`). The fixed
`DUMMY_PASSWORD_HASH` (`passwords.ts:58`) closes the username-enumeration timing channel — verified
that the login path always runs a verify (`routes.ts:72`). The shorter OIDC session TTL
(`sessions.ts:27`) is a correctly-reasoned bound on upstream revocation lag.

`jose` is used properly: `jwtVerify` with JWKS, both issuer spellings, audience, and a 60s clock
tolerance (`oidc.ts:143-147`); `nonce` is checked by the caller against the value the client
generated (`routes.ts:159`), and `state` is checked client-side against `sessionStorage`
(`oidc-pkce.ts:83`) with the pending entry consumed on every path including replay (`:78`).

---

## 2. Privacy & data protection

### 2.1 `purge` — the only real deletion — never reaches the server or peers — **Critical** — [CONFIRMED]

`src/store/store.ts:109-116` documents `purge` as _"the only way a person's data actually leaves the
device rather than being hidden"_, and the UI presents it with an irreversible-action confirmation:

`src/ui/People.tsx:53-60`

```ts
const purge = (id: string, name: string): void => {
  // Confirmed here rather than left to a second screen: purge has no undo …
  if (!window.confirm(t.confirmDelete(name))) return;
  void store.purge('person', id).catch(…);
};
```

`purge` calls `purgeEntity` and `deleteRecords` (`store.ts:287-319`, `store/db.ts:160-166`) — both
strictly local to this device's IndexedDB. A `grep` for `purge` across `src/sync/` and `server/`
returns **nothing**. Consequences, all of them live now that M8 sync has shipped:

1. Every purged operation remains in `server`'s `ops` table forever. The server has no delete
   endpoint at all — the only deletion path is `DELETE /api/admin/users/:id`
   (`admin-routes.ts:206`), which drops the whole account by cascade.
2. Any other device that already pulled those operations keeps them, and keeps showing the person.
   Nothing in the protocol can tell it they were purged.
3. Signing in on a **new** device re-pulls the purged operations from the server and materialises
   the person again. The user performed an action labelled "no undo" and the data came back.

`store.ts:113-115` acknowledges this as a gap deferred to "that engine's own design" — but the
engine now exists, and the ADR's "operations must stay replayable forever" rule means there is no
version of this that resolves itself. This is also the project's right-to-erasure story, and right
now there is no mechanism behind it.

_Remedy:_ this needs a protocol addition, not a patch. The narrow version is a `purge` operation
kind that peers and the server both honour (a tombstone the relay is allowed to act on, deleting the
named rows) — which does breach the "opaque relay" framing and should be an ADR amendment. The
interim honesty fix is to relabel the UI: it deletes from _this device_, not from the account.

### 2.2 Birth coordinates and place names are sent to third parties by default — **High** — [CONFIRMED]

`server/index.ts:83-87` states the guarantee in the code:

```ts
// Birth data never leaves the browser, and the app has no use for camera/microphone,
```

That is no longer true on the default configuration.

**Reverse geocoding** (`src/ui/reverse-geocode.ts:50-57`) sends the exact birth coordinates to
`https://nominatim.openstreetmap.org/reverse`:

```ts
url.searchParams.set('lat', String(latitude));
url.searchParams.set('lon', String(longitude));
```

`zoom=10` (`:57`) coarsens the _response_, not the request. With a MapTiler key configured, the
same coordinates go to `api.maptiler.com` instead (`:40`, `geocode-provider.ts:39-43`), alongside
the API key.

**Forward geocoding** (`src/ui/forward-geocode.ts:61`) sends the user's free-text place query —
which is, by construction, a birth place — to the same third party.

**Referrer is deliberately leaked.** Both geocode paths override the app's blanket
`Referrer-Policy: no-referrer` (`server/index.ts:82`):

`src/ui/reverse-geocode.ts:62` and `src/ui/forward-geocode.ts:66`

```ts
response = await fetch(url, { headers: { Accept: 'application/json' }, referrerPolicy: 'origin' });
```

The reasoning is documented (`geocode-provider.ts:16-20`: Nominatim grants CORS only to requests
carrying a `Referer`), and it is required for the feature to work. But the effect is that a
_self-hosted, private_ Astraya instance discloses its hostname to openstreetmap.org on every
lookup — correlating "this private hostname" with "these birth coordinates" in a third party's
logs.

**Map tiles.** `BirthPlaceMap.tsx` requests raster tiles from `tile.openstreetmap.org` by default
(`csp.ts:47,54`). Tiles are `<img>` loads so no referrer is sent, but the tile coordinates
themselves approximate the birth place, and the anti-abuse `fetch()` probe documented at
`csp.ts:28-36` is a real XHR to that host.

These are all defensible engineering choices for a zero-config default, and each is documented at
its own call site. The problem is that **the privacy posture stated in `server/index.ts:83`, in ADR
0002 ("nothing leaves the device, and that is the whole story"), and presumably on `/about`, no
longer matches the code.**

_Remedy, in order of value:_

1. Correct the claim in `server/index.ts:83`, ADR 0002, and the `/about` page. The ADR is explicitly
   a promise-free document; this contradicts it.
2. Make both geocode calls opt-in per use with an inline disclosure naming the destination host
   ("look this up via nominatim.openstreetmap.org?"), rather than a button whose network
   destination is invisible.
3. Consider truncating the reverse-geocode coordinates to ~2 decimal places (≈1 km) before sending
   — `zoom=10` already means finer input cannot improve the answer, so this costs nothing.

### 2.3 Sign-out leaves a full copy of the account's birth data on the device — **Medium** — [CONFIRMED]

`src/ui/session-context.tsx:325-340`

```ts
async function signOut(): Promise<void> {
  const { endSessionUrl } = await logout();
  localStorage.removeItem(LAST_USER_KEY);
  const anonymous = await openStore();
  engineRef.current?.close();
  storeRef.current?.close();
  …
```

`close()` closes the IndexedDB connection; it never calls `indexedDB.deleteDatabase`. The
per-account database `astraya-user-<id>` (`session-context.tsx:43-45`) remains on disk in full,
indefinitely, after sign-out. There is no "forget this device" action anywhere in the UI.

For a shared or borrowed device this is the whole PII set — names, dates, times, coordinates, notes
— left behind. It is not reachable through the UI without re-authenticating, but it is plainly
readable by anything with filesystem or devtools access to that browser profile.

_Remedy:_ offer an explicit "remove this account's data from this device" action on sign-out, and
delete the database when the user takes it.

### 2.4 `handleUnauthorized` leaves the previous account's store open and writable — **Medium-High** — [CONFIRMED]

`src/ui/session-context.tsx:81-87`

```ts
function handleUnauthorized(userId: string): void {
  orphanedUserIdRef.current = userId;
  engineRef.current?.close();
  engineRef.current = undefined;
  setEngine(undefined);
  setUser(undefined);
}
```

`setUser(undefined)` makes the whole UI render as signed-out, but `storeRef.current` — and therefore
`StoreProvider`'s value — still points at `astraya-user-<previousId>`. `status` is untouched, so it
stays `{ kind: 'ready', store: <the account's store> }`.

In that state a different person at the same device sees a signed-out app, enters birth data, and it
is written into the _previous account's_ database. When the previous user signs back in,
`completeSignIn`'s orphan branch (`:256-271`) resumes that exact store and its sync engine, and the
new data is pushed to the previous user's account.

ADR 0002 names this failure mode specifically — _"Cross-account data bleed is the worst failure mode
here"_ — and `test/session-context.test.tsx` does cover the adoption-side guard. This path is a
different route to the same outcome and appears untested.

_Remedy:_ on unauthorized, either set `status` to something that blocks writes until the user
re-authenticates, or close the account store and open the anonymous one (keeping
`orphanedUserIdRef` so re-authentication can reopen it).

### 2.5 Data at rest and in transit — **partly protected** — [CONFIRMED]

| Location                               | Encrypted?                  | Notes                                                                                                                                          |
| -------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser IndexedDB (authoritative copy) | **No**                      | Plaintext JSON records. This is the primary store for anonymous users.                                                                         |
| Server `ops.payload`                   | **Yes**                     | AES-256-GCM, per-row random 96-bit IV, auth tag concatenated (`ops/crypto.ts:28-35`). Fails closed on tamper (`:42-50`). Correct construction. |
| Server `users`, `sessions`             | **No**                      | Usernames and password hashes in plaintext (hashes are Argon2id, which is the point).                                                          |
| In transit                             | Deployment's responsibility | No HSTS header is set (`server/index.ts:79-93`) — worth adding when `ASTRAYA_PUBLIC_URL` is `https:`.                                          |
| Share links                            | **No**                      | See 2.7.                                                                                                                                       |

The at-rest encryption's stated threat model — a leaked dump or backup, explicitly **not** host
compromise, since key and data share a trust boundary — is written down accurately in ADR 0002 and
`ops/crypto.ts:52-58`. No overstatement found.

One gap: `CURRENT_KEY_VERSION = 1` and the `key_version` column exist, but there is no rotation or
re-encryption command (`ops/crypto.ts:20-21` says so). A leaked key today cannot be rotated without
manual SQL.

### 2.6 Telemetry and logging — **clean** — [CONFIRMED]

No analytics, no telemetry, no error-reporting SDK anywhere in `src/`. Exactly three `console.*`
calls in the whole frontend (`BirthPlaceMap.tsx:111`, `geocode-provider.ts:54`,
`pwa/register.ts:75`), none of which touch PII.

Server-side logging is disciplined: `ops/routes.ts:106` logs `deviceId` and a skew figure but never
payload bytes; `ops.ts:178-184` (`describeType`) deliberately names a rejected value's _type_ without
quoting it, with the reasoning written down. The only leak is the OIDC code in `req.url` (see 1.6b).

### 2.7 Share links carry birth data, correctly kept in the fragment — **Low** — [CONFIRMED]

`domain/chart-share.ts` encodes a full birth moment plus settings into URL parameters, and
`route.ts:74-75` routes it as `#/shared`, so the data sits in the fragment and is never sent to any
server. That is the right design and is correctly implemented.

The residual exposure is human, not technical: a shared link _is_ the recipient's copy of someone's
birth data, permanent in whatever chat log it was pasted into, with no revocation. Worth one
sentence of warning in the share UI. `test/chart-share.ts` covers the encoding.

### 2.8 Data retention and deletion capability — summary

| Capability                                         | Exists?                                                    |
| -------------------------------------------------- | ---------------------------------------------------------- |
| Soft delete (tombstone) with undo                  | Yes — `store.ts:285-286`, `fold.ts:131-133`                |
| Hard delete on this device                         | Yes — `store.purge`                                        |
| Hard delete from the account / server              | **No** (2.1)                                               |
| Hard delete from other devices                     | **No** (2.1)                                               |
| Delete the account and everything in it            | Admin-only — `admin-routes.ts:206`                         |
| Self-service account deletion                      | **No**                                                     |
| Export a copy                                      | Yes — referenced by `persist.ts:111-119`, `ui/download.ts` |
| Remove an account's data from a device on sign-out | **No** (2.3)                                               |

---

## 3. Data loss & corruption risk

### 3.1 Two tabs share one `deviceId` and can mint colliding HLCs — **High** — [CONFIRMED]

The whole ordering design rests on one invariant, stated at `store/oplog.ts:15-18`: _"An HLC
contains the writing device and a per-device counter, so it is globally unique by construction."_

Two tabs of the same origin break it:

- `deviceIdFor` reads the id from the `meta` store and returns it (`store.ts:152-158`). Both tabs
  get the **same** `NodeId`.
- Each tab builds its **own** in-memory `Clock` from `now()` (`store.ts:180`) and its own `log`.
- `tick` (`hlc.ts:166-172`) advances the counter only against _that tab's_ clock.

So two tabs stamping a mutation in the same millisecond produce byte-identical HLCs
(`millis`, `counter=0`, same `nodeId`) for two _different_ operations. There is no coordination
anywhere: `grep` for `BroadcastChannel`, `navigator.locks`, and a `storage` event listener across
`src/` returns nothing.

The consequences:

1. **Silent local loss.** `putRecords` uses `put`, not `add` (`store/db.ts:140-146`), keyed by
   `hlc` (`:54`). The second write silently overwrites the first. The comment at `db.ts:136-138`
   justifies `put` on the grounds that a colliding timestamp with a _different_ operation is
   already impossible — which is exactly the assumption this breaks.
2. **Peer-side rejection.** If both operations do reach the server, the other device's
   `receiveRecords` flags one as `timestamp … is already held by a different operation`
   (`oplog.ts:157`) and quarantines it. That is the correct behaviour for the data it sees, but the
   edit is lost.
3. **Divergent state.** Beyond collisions, each tab's fold is stale with respect to the other's
   writes, because `subscribe` (`store.ts:333-338`) is in-process only. Two tabs showing different
   people lists, each writing over the other's snapshot (`store.ts:234-243`).

`db.ts:119-121` handles the _schema_-version race between tabs (`onversionchange` → `close()`), so
the multi-tab case was considered — just not for the clock. No test covers it: `grep -rl
"multi-tab" test/ e2e/` returns nothing.

_Remedy:_ one of — (a) derive `deviceId` per tab (breaks the "stable device identity" property);
(b) hold a `navigator.locks` mutex so only one tab is the writer and others go read-only;
(c) use a `BroadcastChannel` to share the clock high-water mark and re-fold on a peer tab's write.
(b) is the smallest correct change.

### 3.2 One clock-skewed operation permanently wedges push — **High** — [CONFIRMED]

Server side, an operation whose HLC is more than 24 h ahead is rejected for the whole batch:

`server/ops/routes.ts:91-95`

```ts
for (const op of ops) {
  if (decodeHlc(op.hlc).millis - now > MAX_CLOCK_SKEW_MS) {
    return reply.code(400).send({ error: 'clock-skew', … });
  }
}
```

Client side, `push()` advances `cursor.pushed` **only** after `postOps` resolves
(`src/sync/engine.ts:277-283`):

```ts
const chunk = outgoing.slice(0, MAX_PAGE_SIZE).map(toWire);
await postOps(chunk);
…
cursor = { ...cursor, pushed: lastWire.hlc };
```

`postOps` throws `SyncError('clock-skew')` (`engine.ts:141-142`), `runSync` catches it and calls
`scheduleRetry()` (`:320`), and the retry sends the **same** chunk again. The engine's own comment
states the trap plainly (`engine.ts:57`): _"retrying won't change that op's timestamp."_

So: a device whose clock was a week fast for one minute writes one operation, and from then on
**nothing from that device ever syncs again** — not that operation, and not any of the thousands of
correctly-stamped edits queued behind it. There is no skip, no quarantine, no "move the cursor past
this one" path. Since `outgoing()` is ordered by HLC and the bad op has the highest HLC, every later
edit sorts behind it and is blocked too. The status bar shows a permanent `failing` state
(`ui/status.ts`), and the user's recourse is to lose the data.

`test/sync-engine.test.ts` and `test/server-ops.test.ts` both cover the skew _rejection_. Neither
covers recovery from it, because there is none.

_Remedy:_ on `clock-skew`, quarantine the offending operations — advance `cursor.pushed` past them
into a separate "rejected" list that the UI can surface, so the rest of the queue drains. Better
still, re-stamp them: the user's intent was the edit, not the timestamp.

### 3.3 Server-side op append is not transactional and not base64-validated — **Medium** — [CONFIRMED]

`server/ops/routes.ts:103-129`

```ts
const seqs = ops.map((op) => {
  …
  const { ciphertext, iv } = encryptPayload(Buffer.from(op.payload, 'base64'), key);
  try {
    const result = insert.run(…);
```

Two problems in one loop:

**(a) No transaction.** Up to 500 `INSERT`s run as 500 implicit transactions. If the
`throw new Error(...)` at `:126` fires (or the process dies mid-batch), a _partial_ batch is
committed and the client receives a 500 with no `seqs`. Recovery works only because
`ops_user_hlc` is `UNIQUE` and the client retries the whole chunk — so this is _survivable_, not
_correct_, and it depends on a property no comment connects to it. In WAL mode it is also 500
separate commits where one would do (see 5.3).

**(b) `Buffer.from(x, 'base64')` never throws.** Invalid base64 is silently skipped or truncated, so
a malformed payload is encrypted-and-stored as **corrupted bytes**. The client later pulls it,
`fromBase64`/`JSON.parse` throws inside `fromWire` (`src/sync/engine.ts:121`), and — because
`pull()` maps `fromWire` over the whole page _outside_ any per-row try (`engine.ts:260`) — the
throw escapes `runSync`, is classified as a generic failure, and the retry hits the same poisoned
row forever. **One corrupt row permanently wedges pull for every device on the account**, the
mirror image of 3.2. The server is the right place to stop this: it can verify
`ciphertext.toString('base64') === op.payload` round-trips before storing.

_Remedy:_ wrap the loop in `BEGIN`/`COMMIT`; validate base64 round-trip at `isValidOpInput`
(`ops/routes.ts:43-54`); wrap `fromWire` per row in `pull()` so one bad row is quarantined rather
than fatal.

### 3.4 `resolveAdoption` discards the prompt before doing the network work — **Medium** — [CONFIRMED]

`src/ui/session-context.tsx:308-323`

```ts
async function resolveAdoption(accept: boolean): Promise<void> {
  const pending = pendingAdoptionRef.current;
  if (pending === undefined) return;
  pendingAdoptionRef.current = undefined;   // ← cleared first
  setAdoption(undefined);                   // ← prompt gone

  const outgoing = pending.anonymousStore.outgoing();
  if (accept) {
    await pushRecords(outgoing);            // ← can reject (offline / 503 / rate limit)
    await pending.anonymousStore.setAdoptionDecision(`user:${pending.user.id}`);
    await switchTo(pending.user, true, outgoing);
```

If `pushRecords` rejects — the relay is unconfigured and returns 503 (`ops/routes.ts:76`), or the
network dropped — the prompt is already gone, `pendingAdoptionRef` is already cleared, the adoption
decision was never recorded, and `switchTo` never ran. The user answered "yes, claim my data",
saw the prompt vanish, and is left on the anonymous store with no account store and no way back to
the prompt in this session. This is the one moment in the app where a user's entire pre-account
history is being moved, so it is the worst place for a silent half-failure.

A related fragility at `:230-234`: `switchTo` creates the sync engine (which immediately calls
`trigger()`) **before** `await opened.store.receive(adopted)`. The engine reads `cursor` once at
creation (`engine.ts:200`) and can advance `cursor.pushed` past HLCs lower than the adopted
records', so the engine may never push them. It happens to be safe only because `pushRecords`
already sent them directly — a redundancy, not a guarantee.

_Remedy:_ do the work first, clear the prompt on success, and restore it (with an error) on failure.
Create the engine after `receive`.

### 3.5 No per-user quota on the operation log — **Medium** — [CONFIRMED]

`MAX_BATCH_SIZE = 500` bounds one request (`ops/routes.ts:19`) and `bodyLimit` defaults to 1 MB, but
nothing bounds the total. There is no row count, no byte budget, no retention policy, and no rate
limit on the endpoint (see 1.2). A single authenticated account can append until the volume is full,
at which point **every** account's writes start failing. Sequenced with `openDatabase`'s WAL mode
(`server/db.ts:179`), a full disk is also where SQLite corruption risk concentrates.

### 3.6 Unbounded service-worker cache competes with IndexedDB for the origin quota — **Medium** — [CONFIRMED]

`classify` returns `shell-navigate` for **every** same-origin GET navigation
(`src/pwa/routing.ts:33`), and `staleWhileRevalidate` caches keyed by the full URL including query
(`src/pwa/strategies.ts:62`). There is no `ignoreSearch`, no entry cap, and no eviction inside a
version's cache — `staleCaches` only drops _other versions_ (`src/pwa/cache-names.ts:31-34`).

So every distinct navigation URL adds a permanent full-HTML entry: `/auth/oidc/callback?code=A`,
`?code=B`, and so on. Cache Storage and IndexedDB share one origin quota, and ADR 0002 identifies
eviction under storage pressure as _the_ data-loss vector for an anonymous user. An unbounded shell
cache is therefore not merely bloat — it is a slow push toward evicting the user's only copy of
their data.

_Remedy:_ match navigations with `{ ignoreSearch: true }`, or normalise to `basePath` before the
cache lookup.

### 3.7 Prototype-sensitive `entityId` breaks fold determinism — **Low** — [CONFIRMED (mechanism), SUSPECTED (reachability)]

`src/store/fold.ts:110-121`

```ts
const byId = (next[entity] ??= {});
const fields = byId[entityId];
…
byId[entityId] = { ...fields, [field]: { value, hlc: decoded.spine.hlc } };
```

`entity` is guarded by `KNOWN_ENTITIES.includes(entity)` at `:105`, so `next[entity]` is safe.
`entityId` is not: `readBody` validates only `typeof entityId === 'string' && entityId !== ''`
(`ops.ts:201`). With `entityId === '__proto__'`, the assignment at `:121` invokes the prototype
setter rather than creating an own property. The register object's prototype is replaced by a
`Register` map, so later `byId[someField]` lookups can resolve through it to the wrong register —
and because the value is not an own enumerable property, `JSON.stringify` drops it from the
snapshot, so the same log folds to **different state** before and after a reload.

That directly breaks the determinism guarantee at `fold.ts:5-7` (_"two devices holding the same
records must materialise byte-identical state"_). Reachability is low — local ids come from
`domain/id.ts`, so this needs a tampered or hostile operation, and operations only arrive from the
user's own account — which is why this is ranked Low rather than higher. The `[field]` case is safe:
a computed key creates an own property.

_Remedy:_ reject `__proto__`, `constructor` and `prototype` as `entityId`/`field` in `readBody`, or
use `Object.create(null)` / a `Map` for the register maps.

### 3.8 Migration and schema-versioning integrity — **good** — [CONFIRMED]

Both migration systems are careful and, unusually, correct on the hard cases.

Server (`server/db.ts`): each step is wrapped in `BEGIN`/`COMMIT` with `ROLLBACK` on error
(`:139-159`). Step 3 rebuilds `users`, and the code gets the two things that are normally wrong
right — it drops the _original_ and renames the temp table back so `REFERENCES users(id)` clauses
stay valid (`:82-104`), and it toggles `PRAGMA foreign_keys` **outside** the transaction because
SQLite no-ops that pragma inside one (`:136-138`), then verifies with `PRAGMA foreign_key_check`
and throws rather than committing an orphan (`:146-151`). This is better than most production
migration code I have read.

Client (`src/store/db.ts:49-58`, `:92-131`): a fresh install runs every migration from
`oldVersion + 1` rather than a separate create path (`:102-105`), so the fresh and migrated schemas
cannot drift.

Operation versioning (`src/store/ops.ts`): the frozen-spine / versioned-body split (`:12-27`), the
`UPCASTS` chain that throws on a missing step rather than skipping (`:149-155`), and the
`kind: 'future'` verdict that preserves rather than drops an unreadable operation (`:220`) are
exactly the right design for a log that must replay forever. `test/fixtures/oplog-v1.json` pins it.

One residual: `readBody` rejects a record carrying **unexpected keys** at the current version
(`ops.ts:195-198`). The reasoning (a newer client must bump `opVersion`) is sound — but it means a
single mistake in a future release (adding a field without bumping) turns every such operation into
`corrupt` on _older_ clients, which is the silent-loss class #97 exists to prevent. A release-gate
test asserting "no field added without a version bump" would close it.

### 3.9 Durability ordering — **correct** — [CONFIRMED]

Worth recording as verified, because it is the easiest thing to get wrong and this code does not:
`committed()` waits for transaction `oncomplete`, not request `onsuccess`
(`src/store/db.ts:78-90`), with the reasoning written down; `commitRecords` writes durably
_before_ mutating in-memory state or notifying listeners (`store.ts:223-246`); `serialise` chains
on a tail promise with `catch` on the tail but not on the returned promise, so one failed mutation
neither poisons the queue nor hides the error from its caller (`store.ts:207-215`); the sync engine
persists its cursor only after the call that earned it (`engine.ts:266-267`, `:282-283`); and
snapshot writes are explicitly best-effort because a stale snapshot is only a slower launch
(`store.ts:236-243`). `resume`'s count-based staleness check (`fold.ts:201-211`, `:256-265`) —
rather than the timestamp filter that looks right and is not — is the single sharpest piece of
reasoning in the codebase.

---

## 4. Code quality

The bar here is high, so this section is short and specific.

### 4.1 Every device re-uploads every operation it pulled — **Medium** — [CONFIRMED]

`outgoing()` is `since(log, cursor.pushed)` (`store.ts:320`), and `since` filters **only** by HLC —
not by `deviceId` (`oplog.ts:184-189`). `runSync` calls `pull()` then `push()`
(`engine.ts:293-294`), so every operation just pulled from a peer now sorts after `cursor.pushed`
and is pushed straight back.

A new device joining an account with 5,000 operations pulls all 5,000, then uploads all 5,000 again
in ten batches. Server-side each one is a failed `INSERT` (caught) plus a `SELECT`
(`ops/routes.ts:121-127`). It is correct — `ops_user_hlc` makes it idempotent — but it is a
one-time 2× cost per device that a `deviceId` filter in `since()` would remove entirely.

### 4.2 Unbounded pending map, no request timeout in the worker client — **Low** — [CONFIRMED]

`WorkerEphemerisProvider.#pending` (`src/ephemeris/client.ts:84`) is only drained by `#settle` on a
reply or `#fail` on a _transport_ error (`:114-118`). If the WASM engine enters a non-converging
search — `nextSunCrossing`/`nextMoonCrossing` are iterative — the worker neither replies nor errors,
the promise never settles, and the UI shows the spinner-forever state that
`client.ts:108-113` explicitly says it exists to prevent. No timeout anywhere.

### 4.3 `insertionIndex`'s defensive `break` can return a wrong index — **Low** — [CONFIRMED]

`src/store/oplog.ts:48-59`

```ts
const at = records[middle];
if (at === undefined) break;
```

`middle` is always `< high <= records.length`, so with `noUncheckedIndexedAccess` this branch exists
only to satisfy the type checker. But `break` exits the binary search and returns the current `low`
— a _plausible but wrong_ index — where the honest response to an impossible state is to throw.
Same shape at `oplog.ts:77`: `at?.hlc === hlc` compares a possibly-non-string `hlc` with `===`,
while the surrounding code uses `String(at.hlc)` (`:55`, `:81`, `:194`). Inconsistent, and the
inconsistency is exactly where a silent miss would hide.

### 4.4 Unguarded `JSON.parse` at boot can white-screen the app — **Low** — [CONFIRMED]

`src/ui/oidc-pkce.ts:82`

```ts
const pending = JSON.parse(raw) as PendingOidc;
```

No `try`, and no validation of the parsed shape. `consumeOidcCallback()` is called at
`session-context.tsx:120`, which is **outside** the `try` block that begins at `:122`. A corrupt
`astraya:oidcPending` value therefore rejects the mount effect's async body, `setStatus` is never
called, and the app sits on `{ kind: 'opening' }` forever. Low likelihood, but the failure mode is a
permanent blank screen.

Also at `oidc-pkce.ts:79`: `history.replaceState(null, '', '/')` hardcodes the root, which is wrong
under a non-default `VITE_BASE_PATH` (`vite.config.ts:76`).

### 4.5 Offline sign-out is not possible — **Low** — [CONFIRMED]

`signOut` awaits `logout()` first (`session-context.tsx:326`). `logout` has no `try` around its
`fetch` (`sync/auth-client.ts:56`), so offline it throws and the whole function aborts — the user
stays signed in locally, with the account store open. Local sign-out should not depend on the
network.

### 4.6 Missing-error-handling and validation nits — **Low** — [CONFIRMED]

- `forward-geocode.ts:51-52` reads `feature.geometry.coordinates[1]` with no guard; the tuple type
  comes from an `as` cast of untrusted JSON (`:47`), so a malformed response is a `TypeError`, not a
  handled failure.
- `ops/routes.ts:139` — `Number(request.query.since ?? '0')`: `Number('')` is `0` and `Number(' ')`
  is `0`, so a blank `?since=` silently means "from the beginning". Harmless, but `since` is the
  one parameter where "silently start over" is the expensive answer.
- `store/db.ts:127-129` — `onblocked` rejects the open promise, but `onsuccess` can still fire
  afterwards, resolving an already-rejected promise (a no-op) and leaking an open connection nobody
  holds.
- `src/pwa/sw-core.ts:95-100` — `Promise.all` over the precache list means one failed asset fails
  the whole `install`. `allSettled` would degrade instead, matching `readManifest`'s own
  stated philosophy at `:60-62`.
- Stale doc comments that now assert the opposite of the code: `identity.ts:145-147`,
  `store.ts:112-115`, `store.ts:117` ("for the sync engine in M8").

### 4.7 Type-safety gaps

Essentially none. No `any`, no `<any>`, no `as any` in `src/` or `server/`. The `as unknown as T`
casts that exist are all at genuine untyped boundaries and are all narrowed immediately afterwards:
`node:sqlite` row casts (`db.ts:130`, `:146`, and throughout `server/`), and `store/ops.ts`'s
`decode`, which validates every field before returning `kind: 'known'`.

One unchecked cast is load-bearing and deserves a comment it does not have: `oplog.ts:169`

```ts
const record = candidate as OpRecord;
```

This is where data from the network enters the durable log. It is _safe_ — `decode` has already run
(`:141`) and `OpRecord` is `Readonly<Record<string, unknown>>`, so the cast asserts almost nothing —
but it is the exact line where 3.7's `entityId` problem lands, and it reads like a normal cast.

### 4.8 Test coverage — strong, with named gaps

1,508 tests, including property-based suites (`fast-check` in `store-sync-properties.test.ts`,
`astrology-properties.test.ts`), a golden-chart gate against JPL Horizons fixtures, a11y checks via
`@axe-core/playwright`, and 11 Playwright golden-path specs. Coverage of the store/sync/server core
is unusually thorough.

Uncovered paths, each corresponding to a finding above:

| Gap                                                                                       | Finding |
| ----------------------------------------------------------------------------------------- | ------- |
| Multi-tab concurrent writes (`grep -rl "multi-tab" test/ e2e/` → nothing)                 | 3.1     |
| Recovery from a clock-skew rejection (only the rejection is tested)                       | 3.2     |
| Partial-batch failure in `POST /api/ops`                                                  | 3.3     |
| `pushRecords` failing inside `resolveAdoption`                                            | 3.4     |
| `ASTRAYA_GEOCODE_ORIGIN`/`ASTRAYA_TILE_ORIGIN` wired through `build()` to the served HTML | 1.7     |
| `handleUnauthorized` leaving the account store writable                                   | 2.4     |
| `isOnlyRemainingAdmin` with a disabled admin present                                      | 1.5     |
| Purge-then-sync-on-a-second-device                                                        | 2.1     |

---

## 5. Performance & optimization

### 5.1 Eleven `WorkerEphemerisProvider` sites; three concurrent WASM instances on the chart screen — **Medium-High** — [CONFIRMED]

Every view constructs its own provider, and each construction spawns a dedicated Worker that
compiles `swisseph.wasm` (584 KB, `assets.ts:69`) and loads ~2.0 MB of `.se1` data into the WASM
filesystem (`engine.ts:200-204`):

| Site                                                                                                                                                                                                                                | Count                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `App.tsx:120`                                                                                                                                                                                                                       | 1 — lives for the whole app lifetime, purely to read `version()` |
| `ChartView.tsx:651` and `:663`                                                                                                                                                                                                      | **2** — one for the settings panel, one for computation          |
| `TransitView.tsx:82`, `SynastryView.tsx:93`, `CompositeView.tsx:52`, `HarmonicView.tsx:45`, `ProfectionsView.tsx:89`, `PeriodicTransitView.tsx:187`, `AstrocartographyView.tsx:92`, `ReportScreen.tsx:32`, `SharedChartView.tsx:44` | 1 each                                                           |

Disposal on unmount is correct at every site (`ChartView.tsx:657`, `:669`; `App.tsx:140-143`;
`TransitView.tsx:87-90`), so this is not a leak — but on the chart screen **three** full engines are
resident simultaneously, roughly 3× (584 KB code + ~2 MB heap). On a mid-range phone that is a
plausible OOM, and every navigation pays a fresh WASM compile plus a fresh 2 MB load.

`ChartView.tsx:634-648` documents at length why the two providers within that component are not
shared with each other. The reasoning is right for the problem it was solving (a settings tweak must
not re-pay initialisation) and misses the larger one: the same argument applies across components.

_Remedy:_ hoist one `WorkerEphemerisProvider` to a React context created at app start and consumed
everywhere. The worker already serialises requests through one promise chain
(`worker.ts:90-105`), and every method already carries its own zodiac/observer options
(`engine.ts:232-260`) — `ChartView.tsx:639-648` argues exactly that, for reuse within a component.
It holds globally too.

### 5.2 Any store change anywhere re-triggers a full chart recomputation — **Medium-High** — [CONFIRMED]

`materialise` runs on **every** `commitRecords` and rebuilds all `Person`/`Chart` objects and both
Maps from scratch (`fold.ts:163-193`, called at `store.ts:231`). Every object identity changes.

`ChartView`'s compute effect depends on the `person` object:

`src/ui/ChartView.tsx:694`

```ts
}, [personId, person, settings, chartProvider]);
```

where `person = state.people.get(personId)` (`:630`). So a sync pull that merges an operation for a
_completely unrelated_ person produces a new `state`, a new `person` identity, a changed dependency,
`setLoad({ kind: 'loading' })` (`:675`), and a full `computeChartData` — hundreds of ephemeris
round-trips. With the 30-second sync poll (`engine.ts:23`), a user on a multi-device account can see
the chart flash back to a loading state and recompute on a timer.

_Remedy:_ depend on the _content_ that matters, not the object — e.g.
`[personId, person?.moment && encodeBirthMoment(person.moment).toString(), settings, chartProvider]`
— or memoise the moment. The same pattern repeats in every view's compute effect.

### 5.3 Synchronous SQLite on the event loop, plus 500 commits per batch — **Medium** — [CONFIRMED]

`server/db.ts:13` uses `node:sqlite`'s `DatabaseSync`, so **every** query blocks the Node event
loop. For the small, fast queries this is a reasonable trade (and the reason for choosing it over
`better-sqlite3` is sound — `db.ts:10-11`). Two places make it bite:

1. `POST /api/ops` runs up to 500 individual `INSERT`s with no surrounding transaction
   (`ops/routes.ts:103-129`). In WAL mode that is 500 separate commits — 500 fsyncs — with the event
   loop blocked throughout. A single `BEGIN`/`COMMIT` would make it one, and would also fix 3.3(a).
2. `GET /api/ops` decrypts up to 500 payloads synchronously in the response map
   (`ops/routes.ts:150-162`).

### 5.4 `receiveRecords` is O(n²) on a bulk pull — **Medium** — [CONFIRMED]

`insert` copies the entire records array for **each** record
(`src/store/oplog.ts:80-83`):

```ts
return [...records.slice(0, index), record, ...records.slice(index)];
```

and `receiveRecords` calls it once per incoming record (`:170`). Pulling a 500-row page into a
10,000-record log is ~5 M element copies and 500 array allocations, all on the main thread inside
one `store.receive` call. The binary search that finds the index is careful about being O(log n);
the splice that follows undoes it.

_Remedy:_ for a batch, sort the incoming records and merge once — O(n + m) instead of O(n·m).

### 5.5 `previewDeletionImpact` loads and decrypts an entire operation log, synchronously — **Medium** — [CONFIRMED]

`server/ops/deletion-impact.ts:32`

```ts
const rows = db.prepare('SELECT payload, iv FROM ops WHERE user_id = ?').all(userId) as unknown as PayloadRow[];
```

No `LIMIT`. Every row for the target user is materialised into memory, then each is AES-GCM
decrypted and `JSON.parse`d in a synchronous loop (`:37-49`) — on the event loop, in an HTTP
handler, with no rate limit (1.2) on a `GET` that Lax cookies permit cross-site (1.10). For a
heavy account this is seconds of full-process stall, triggerable repeatedly.

_Remedy:_ the answer wanted is a count of distinct entity ids. Either bound the scan with a `LIMIT`
and report `kind: 'approximate'` past it (the type already exists, `:15`), or maintain the counts
incrementally.

### 5.6 Bundle size — tight but gated — [CONFIRMED]

| Asset                     | Size                                                                     |
| ------------------------- | ------------------------------------------------------------------------ |
| `index-*.js` (main chunk) | 825,622 B — against a 900 KB budget (`scripts/check-bundle-size.mjs:26`) |
| `swisseph-*.wasm`         | 584,227 B — code-split, lazily imported (`engine.ts:196`)                |
| `leaflet-src-*.js`        | 148,736 B — code-split                                                   |
| `index-*.css`             | 34,402 B                                                                 |

The gate is well designed: it checks chunk _count_ as well as size, so replacing a dynamic `import()`
with a static one is caught before the budget is (`check-bundle-size.mjs:8-13`). But 825 KB of 900 KB
is 92% of budget, and the main chunk is what every first-time visitor downloads before anything
renders. The interpretation corpus is already correctly split out and fetched at runtime
(`interpretation/corpus-client.ts`) rather than inlined — that was the right call and is worth
applying again: the remaining candidates for lazy loading are the per-view chart modules
(`src/chart/**` is 21 files) and `ExtendedSettingsPanel`/`AdminPanel`, none of which the home screen
needs.

### 5.7 Worker round-trip granularity — **Low** — [SUSPECTED]

`worker.ts:74-89` notes that a full chart is "hundreds of ephemeris calls", and `serveEphemeris`
strictly serialises them through one promise chain (`:91-104`). Each call is a separate
`postMessage` with its own structured clone and event-loop turn. `positions()` batches bodies
(`client.ts:157`), which is the main hot path and is good — but the per-call overhead for the long
tail (fixed stars, crossings, house-system name lookups) is a real fixed cost that batching more
aggressively would remove. Not measured here, hence SUSPECTED.

### 5.8 No memory leaks found in listener lifecycles — [CONFIRMED]

Checked because this is where React apps usually leak, and it is clean: `engine.close()` removes the
`online` listener, clears both timers and the interval, unsubscribes from the store, and clears its
listener set (`sync/engine.ts:361-369`); `store.close()` clears listeners and closes the database
(`store.ts:339-342`); `subscribeToUpdates` returns a real unsubscribe (`pwa/register.ts:27-32`);
every view's ephemeris effect disposes its provider on unmount. The one unbounded collection is
`WorkerEphemerisProvider.#pending` (4.2), and the one on the server is the login-throttle map (1.3).

---

## Appendix — recommended order of work

**Now (data integrity and privacy correctness):**

1. 2.1 — decide and implement what `purge` means for an account, or relabel it. Needs an ADR
   amendment.
2. 3.2 — quarantine clock-skew-rejected operations so the push queue can drain.
3. 3.1 — a `navigator.locks` writer mutex for multi-tab.
4. 2.2 — correct the "birth data never leaves the browser" claim, then make geocoding's destination
   visible at the point of use.
5. 3.3 — wrap the ops append in a transaction; validate base64 round-trip; make `pull()`'s
   `fromWire` per-row fault-tolerant.

**Next (security hardening, all small):** 6. 1.1 — scope `trustProxy`; derive the cookie's `secure` flag from config. 7. 1.2 — add rate limits to the four unprotected route groups. 8. 1.7 — include `geocodeOrigin` in the meta-strip condition; add the missing server test. 9. 1.6 — bypass the SW for the OIDC callback path; add `logger.redact`. 10. 1.5 — exclude disabled admins from the last-admin count. 11. 1.8 — do not cache a rejected discovery promise. 12. 2.4 — close or freeze the account store on unauthorized.

**Then (performance, user-visible):** 13. 5.1 — one shared ephemeris provider via context. 14. 5.2 — depend on moment content, not `person` identity, in every compute effect. 15. 5.5 / 5.3 — bound `previewDeletionImpact`; batch the ops insert. 16. 5.4 — merge-insert for bulk `receiveRecords`.

**Housekeeping:** 17. 1.9 — escape `"`/`'` in `escapeXml`. 18. 3.7 — reject `__proto__`/`constructor`/`prototype` as `entityId`/`field`. 19. 4.2 — timeout on ephemeris worker calls. 20. 4.4, 4.5, 4.6, and the stale doc comments in 4.6.
