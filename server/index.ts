/**
 * Astraya's HTTP server.
 *
 * Today it only serves the built single-page app. It is Fastify rather than a
 * static file server because of what comes later: in M8 this same process gains
 * the sync relay, and choosing the serving layer now means the image does not have
 * to be rearchitected then. The relay's seam is marked below.
 *
 * It never participates in calculation. Charts are computed in the browser, and a
 * user who never signs in reaches this server only to download the app itself.
 */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { CSP_HEADER } from './csp.ts';

const here = dirname(fileURLToPath(import.meta.url));
const distRoot = resolve(here, '..', 'dist');

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';

/**
 * Hashed build assets and the ephemeris data files are immutable for the life of a
 * release, so they are cached hard. `index.html` must not be, or a browser would
 * keep loading an old app against new assets after a deploy.
 */
const IMMUTABLE = 'public, max-age=31536000, immutable';
const NO_CACHE = 'no-cache';

export async function build() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // Behind a reverse proxy on the user's own box, so trust its forwarding headers.
    trustProxy: true,
  });

  app.addHook('onSend', async (request, reply) => {
    reply.header('Content-Security-Policy', CSP_HEADER);
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

  // --- The sync relay mounts here in M8. -------------------------------------
  // A single `ops` table and an append-only log; the server never interprets a
  // payload, which is why a new domain field will ship as a client release with
  // no migration and no server deploy.
  // ---------------------------------------------------------------------------

  await app.register(fastifyStatic, { root: distRoot, index: ['index.html'] });

  // SPA fallback. Routes are client-side, so an unknown path is the app's problem
  // to resolve, not a 404 — except for API paths, where a 404 is the honest answer.
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
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
