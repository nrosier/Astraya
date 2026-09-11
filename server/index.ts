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
  const csp = buildCsp(oidcConfig ? { issuerOrigin: new URL(oidcConfig.issuer).origin } : {});

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });

  app.addHook('onSend', async (request, reply) => {
    reply.header('Content-Security-Policy', csp.header);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    // Birth data never leaves the browser, but the app has no use for these APIs
    // either, so deny them rather than rely on nobody asking.
    reply.header('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
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
  // Only registered when an issuer is configured: the meta tag can't express an
  // issuer-scoped `connect-src`/`form-action`, so once one exists the header
  // becomes the only correct copy of the policy (see `stripCspMeta`'s doc comment).
  if (oidcConfig) {
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
