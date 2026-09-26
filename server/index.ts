/**
 * Astraya's HTTP server.
 *
 * It serves the built single-page app, and — as of M8 — local-account sign-in
 * (`server/auth/`) and an operation relay (`server/ops/`) against a SQLite
 * database it owns (`server/db.ts`). All additive: a user who never signs in
 * reaches this server only to download the app itself, exactly as before.
 *
 * It never participates in calculation. Charts are computed in the browser, and
 * the server stores accounts and an opaque operation log, never a person or a
 * chart — see ADR 0002.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import { buildCsp, stripCspMeta } from './csp.ts';
import { isCrossOriginWrite } from './csrf.ts';
import { openDatabase } from './db.ts';
import { registerAuthRoutes } from './auth/routes.ts';
import { registerAdminRoutes } from './auth/admin-routes.ts';
import { loadOidcConfig } from './auth/oidc.ts';
import { registerOpsRoutes } from './ops/routes.ts';

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(here, '..', 'dist');

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const DB_PATH = process.env.ASTRAYA_DB_PATH ?? resolve(here, '..', 'data', 'astraya.db');

/**
 * Hashed build assets and the ephemeris data files are immutable for the life of a
 * release, so they are cached hard. `index.html` must not be, or a browser would
 * keep loading an old app against new assets after a deploy.
 */
const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';

/**
 * 180 days, subdomains included — long enough to be worth setting, short enough that a
 * deployer who later moves off TLS is not locked out for two years. Deliberately no
 * `preload`: that is a one-way submission to a browser-vendor list on behalf of someone
 * else's domain, which is not this server's decision to make.
 */
const HSTS = 'max-age=15552000; includeSubDomains';

export interface BuildOptions {
  /** Overrides `ASTRAYA_DB_PATH`. Tests pass `:memory:` so nothing touches disk. */
  readonly dbPath?: string;
}

export async function build(options: BuildOptions = {}) {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // Behind a reverse proxy on the user's own box, so trust its forwarding headers.
    trustProxy: true,
  });

  const db = openDatabase(options.dbPath ?? DB_PATH);
  app.addHook('onClose', () => {
    db.close();
  });

  // `loadOidcConfig` throws on a present-but-malformed issuer — deliberately, so
  // a deployment mistake fails the boot rather than silently serving OIDC-less.
  const oidcConfig = loadOidcConfig();
  // A self-hosted tile server (#159): its origin replaces the default public OSM
  // host in `img-src`. Must match the scheme+host `VITE_TILE_URL_TEMPLATE` was
  // built against, or the browser's own CSP blocks tiles from the mismatched host.
  const tileOrigin = process.env.ASTRAYA_TILE_ORIGIN;
  // A self-hosted Nominatim instance (#291): its origin replaces the default
  // public Nominatim host in `connect-src`. Must match the scheme+host
  // `VITE_NOMINATIM_URL` was built against, or the CSP blocks the lookup.
  const geocodeOrigin = process.env.ASTRAYA_GEOCODE_ORIGIN;
  const csp = buildCsp({
    ...(oidcConfig ? { issuerOrigin: new URL(oidcConfig.issuer).origin } : {}),
    ...(tileOrigin ? { tileOrigin } : {}),
    ...(geocodeOrigin ? { geocodeOrigin } : {}),
  });

  // HSTS is only correct once the deployment is actually served over TLS, and
  // `ASTRAYA_PUBLIC_URL` is the one place a deployer already states that (#339). Sending it
  // unconditionally would make a plain-HTTP instance — the local-network case this app is
  // built for — unreachable in any browser that had ever seen the header. `URL.parse`
  // rather than `new URL`: a malformed value here must not become a boot failure for a
  // server that has no other reason to need it.
  const publicOrigin = process.env.ASTRAYA_PUBLIC_URL ? URL.parse(process.env.ASTRAYA_PUBLIC_URL) : null;
  const hsts = publicOrigin?.protocol === 'https:';

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });

  // Registered before every route, including the static handler, so no write can be added
  // that forgets it — see `server/csrf.ts` for why this is an origin check rather than a
  // token.
  app.addHook('onRequest', async (request, reply) => {
    const allowedHosts = publicOrigin === null ? [request.host] : [request.host, publicOrigin.host];
    if (isCrossOriginWrite({ method: request.method, origin: request.headers.origin, allowedHosts })) {
      await reply.code(403).send({ error: 'Cross-origin request rejected' });
    }
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('Content-Security-Policy', csp.header);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    if (hsts) reply.header('Strict-Transport-Security', HSTS);
    // Birth data never leaves the browser, and the app has no use for camera/microphone,
    // so those stay denied. Geolocation is allowed for this origin only (#248's opt-in
    // "Use my location" map control) — it never leaves the browser either, and the
    // permission still requires an explicit user gesture and browser prompt per use.
    reply.header('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    if (request.url.startsWith('/ephe/') || request.url.startsWith('/assets/')) {
      reply.header('Cache-Control', IMMUTABLE);
    } else if (!request.url.startsWith('/healthz')) {
      reply.header('Cache-Control', NO_CACHE);
    }
  });

  app.get('/healthz', () => ({ status: 'ok' }));

  registerAuthRoutes(app, db);
  registerAdminRoutes(app, db);
  registerOpsRoutes(app, db);

  await app.register(fastifyStatic, { root: distRoot, index: ['index.html'] });

  // Only computed when an issuer is configured, and only read from disk on first
  // request, not here: CI runs the test suite before `npm run build`, so `dist/`
  // doesn't exist yet while `build()` is called from tests — an eager read here
  // would make every server test depend on a prior build having already run.
  let strippedIndexHtml: Buffer | undefined;
  async function getStrippedIndexHtml(): Promise<Buffer> {
    if (!strippedIndexHtml) {
      const raw = await readFile(resolve(distRoot, 'index.html'), 'utf8');
      strippedIndexHtml = Buffer.from(stripCspMeta(raw), 'utf8');
    }
    return strippedIndexHtml;
  }

  // `@fastify/static`'s `wildcard: true` (the default) registers exactly one
  // route, `GET/HEAD /*` — not a literal `/` — so find-my-way's exact-beats-
  // wildcard resolution means this route wins regardless of registration order.
  // Only registered when an issuer or a custom tile origin is configured: the
  // static meta tag can't express an issuer-scoped `connect-src`/`form-action`
  // or a non-default `img-src`, so once either exists the header becomes the
  // only correct copy of the policy (see `stripCspMeta`'s doc comment).
  if (oidcConfig || tileOrigin) {
    app.get('/', async (_request, reply) => {
      return reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', NO_CACHE)
        .send(await getStrippedIndexHtml());
    });
  }

  // SPA fallback. Routes are client-side, so an unknown path is the app's problem
  // to resolve, not a 404 — except for API paths, where a 404 is the honest answer.
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    if (oidcConfig) {
      return reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', NO_CACHE)
        .send(await getStrippedIndexHtml());
    }
    return reply.type('text/html').header('Cache-Control', NO_CACHE).sendFile('index.html');
  });

  return app;
}

/** True when this module is the process entry point rather than an import. */
const isEntryPoint = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`;

if (isEntryPoint) {
  const app = await build();

  // Containers are stopped with SIGTERM. Without this the process is killed
  // mid-request and the orchestrator reports an unclean exit on every deploy.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      app.log.info(`${signal} received, shutting down`);
      void app.close().then(() => process.exit(0));
    });
  }

  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}
