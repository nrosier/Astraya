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

ARG NODE_VERSION=24-alpine

# ---- dependencies (cached on the lockfile alone) ----------------------------
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- build ------------------------------------------------------------------
FROM --platform=$BUILDPLATFORM node:${NODE_VERSION} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

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
FROM node:${NODE_VERSION} AS runtime-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime ----------------------------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0

COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY server ./server

# node:alpine already provides an unprivileged `node` user. Nothing in the
# container is written to at runtime, so the whole tree stays read-only to it.
USER node

EXPOSE 8080

# /healthz is served by the app itself, so this checks the process is actually
# answering requests rather than merely still running.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT??8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server/index.ts"]
