# syntax=docker/dockerfile:1

# Astraya ships as a single image: the built SPA plus the Fastify process that
# serves it. One image rather than two, because the sync relay (M8) is another
# route on this same server — adding it later must not mean re-architecting how
# the app is deployed.
#
# Node 24 runs the server's TypeScript directly via built-in type stripping, so
# there is no server build step and no second toolchain in the runtime image.
#
# Everything the build produces — bundled JS, the SVG/CSS, the .se1 ephemeris
# files — is architecture-independent, so the build stages are pinned to
# $BUILDPLATFORM and run natively even for an arm64 target. Only the runtime
# layers are built per architecture. Multi-arch therefore costs one extra small
# `npm ci --omit=dev` under emulation instead of a full toolchain run.
#
# Base: Chainguard/Wolfi (glibc), not Alpine (musl). @node-rs/argon2 ships
# prebuilt native binaries per libc; glibc is what avoids the musl ABI class of
# problems entirely, and every stage below builds on it end to end so no
# musl-linked artifact ever meets a glibc runtime. Chainguard's free tier only
# publishes `latest`/`latest-dev` — there is no pinned-point-release tag to ARG
# in, unlike the old `node:24-alpine`. `-dev` (has npm, a shell, coreutils) for
# anything that installs or builds; the bare runtime tag for the final stage.
# The musl build is kept as Dockerfile.alpine for reference; it is not built by CI.

# ---- dependencies (cached on the lockfile alone) ----------------------------
FROM --platform=$BUILDPLATFORM cgr.dev/chainguard/node:latest-dev AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM cgr.dev/chainguard/node:latest-dev AS build
WORKDIR /app
# --chown throughout: the default runtime-dev user (65532, "node") has to own
# what it builds — a plain COPY lands as root, and tsc/ephe:sync/corpus:split
# then can't write their build outputs into node_modules or public/.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node . .

# The About page and the in-app changelog report the running commit, which is
# also how the AGPL source-for-this-build link is formed. Passed in rather than
# read from git, because .git is deliberately not in the image context.
ARG GITHUB_SHA=unknown
ENV GITHUB_SHA=${GITHUB_SHA}

# The ephemeris data files are not committed. Syncing copies them out of
# node_modules and verifies each against its pinned SHA-256, so a repacked
# upstream fails the build instead of silently changing the numbers we publish.
RUN npm run ephe:sync

# The interpretation corpus is committed whole but served in small per-(locale,
# persona) chunks; the build inlines whatever public/ contains, so without this
# the running app would 404 fetching its report text.
RUN npm run corpus:split

RUN npm run build

# ---- runtime dependencies ---------------------------------------------------
FROM cgr.dev/chainguard/node:latest-dev AS runtime-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime ----------------------------------------------------------------
FROM cgr.dev/chainguard/node:latest AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server

# The ops relay (server/ops/routes.ts) parses HLC timestamps using the client's
# own encoding, on purpose, so the two can never drift apart into different
# ideas of what a timestamp is (see src/store/hlc.ts's own docstring). Copied
# alone rather than the whole client tree.
COPY --from=build /app/src/store/hlc.ts ./src/store/hlc.ts

# server/corpus-overrides-routes.ts (#354) runs an admin's hand-typed correction
# through the same content-quality lint tools/corpus-gen already runs on every
# machine-produced entry, so it needs this one file from src/ at runtime too.
COPY --from=build /app/src/interpretation/lint.ts ./src/interpretation/lint.ts

# `data/` is the one writable path in the tree — it holds the SQLite file plus
# its WAL/SHM siblings (server/db.ts). Owned by UID:GID 1000, not Chainguard's
# own nonroot account (65532): existing deployments' `-v astraya-data:/app/data`
# (README) is a named volume already owned by 1000 from the Alpine `node` user,
# and there's no host bind-mount here to protect from UID collisions — so
# matching the old UID avoids forcing a chown migration on every deployment for
# no real benefit. A numeric USER doesn't need a passwd entry (Chainguard has
# none for 1000, only for its own 65532); Linux runs a process by UID whether or
# not a name resolves. USER root below is build-time only — chown to a UID
# other than the image's own default requires it — the USER after is what the
# running container actually gets.
USER root
RUN mkdir -p data && chown 1000:1000 data
VOLUME /app/data

USER 1000:1000

EXPOSE 8080

# /healthz is served by the app itself, so this checks the process is actually
# answering requests rather than merely still running. Exec form (not `CMD
# node -e ...` as a string): the runtime image has no guaranteed shell to
# interpret a shell-form CMD through.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT??8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# Chainguard's node image sets ENTRYPOINT ["/usr/bin/node"] itself, so CMD is
# just the script path — "node", "server/index.ts" would run `node node
# server/index.ts` and fail to find a module named "node".
CMD ["server/index.ts"]
