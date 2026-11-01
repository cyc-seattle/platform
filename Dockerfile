FROM node:22-alpine AS base

# Runs on the build host's own architecture (arm64 on Apple Silicon) instead of under emulation,
# even though clubspot-sync/gsuite-sync below stay linux/amd64 (cyc-seattle/isthmia#129). The
# bundles are plain JavaScript, so a cross-arch build here is safe.
FROM --platform=$BUILDPLATFORM base AS build
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && npm install -g corepack@latest
WORKDIR /usr/src/app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts: esbuild's binary comes from its platform package, so no install script needs to
# run, and this layer stays cached across source-only changes.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY src/model/ src/model/
COPY src/syncs/ src/syncs/
# Each sync becomes one file with its dependencies inside, so the images need no node_modules. The
# banner gives the CommonJS dependencies the `require` an ES module lacks.
RUN pnpm exec esbuild src/syncs/clubspot/main.ts src/syncs/gsuite/main.ts \
    --bundle --platform=node --target=node22 --format=esm \
    --outbase=src/syncs --outdir=/usr/app --out-extension:.js=.mjs \
    --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

FROM base AS clubspot-sync
COPY --from=build --chown=node:node /usr/app/clubspot/main.mjs /usr/app/main.mjs
WORKDIR /usr/app
# Numeric, so Kubernetes' runAsNonRoot can verify it. 1000 is the base image's `node`.
USER 1000:1000
ENV NODE_ENV=production
CMD ["node", "main.mjs", "--logging", "json"]

FROM base AS gsuite-sync
COPY --from=build --chown=node:node /usr/app/gsuite/main.mjs /usr/app/main.mjs
WORKDIR /usr/app
USER 1000:1000
ENV NODE_ENV=production
CMD ["node", "main.mjs", "--logging", "json"]
