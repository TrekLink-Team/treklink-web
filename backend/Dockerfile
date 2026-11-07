# Production image of the backend for the AWS field host (specs/platform/design.md §2.5, D-098).
# Build from the repository root, because the lockfile and the npm workspaces live there:
#   docker build -f backend/Dockerfile -t treklink-backend .
# The image runs `node dist/main` only. It never runs `prisma migrate` or a seed: the Vercel production
# build migrates and seeds treklink_prod (backend/scripts/vercel-build.sh).
#
# Multi-architecture: every base image has amd64 and arm64 variants, and `prisma generate` runs inside the
# build stage, so the Prisma `native` engine is the image's own platform (debian-openssl-3.0.x on amd64,
# linux-arm64-openssl-3.0.x on arm64). bcrypt uses its prebuilt binary when one exists for the platform
# and otherwise compiles with the toolchain of the build stages. The slim image has neither libssl nor a
# CA store, so the runtime stage installs openssl (the Prisma engine links libssl 3) and ca-certificates
# (the engine verifies Neon's certificate against the system store).

ARG NODE_IMAGE=node:22-bookworm-slim

# ---- build: every dependency of the backend workspace, the Prisma client and the compiled app ----
FROM ${NODE_IMAGE} AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# No update check or telemetry call from the Prisma CLI during the build.
ENV CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app
# npm checks the lockfile against every workspace, so all three manifests are copied.
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY gateway/package.json gateway/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci -w backend --no-audit --no-fund
COPY backend/ backend/
WORKDIR /app/backend
RUN npx prisma generate && npm run build

# ---- prod-deps: production dependencies only ----
FROM ${NODE_IMAGE} AS prod-deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY gateway/package.json gateway/package.json
COPY frontend/package.json frontend/package.json
# A package npm could not hoist stays in backend/node_modules; the folder is created so the copy below
# works either way. npm installs the Prisma CLI as the optional peer of @prisma/client even with
# --omit=dev; it is removed with its engines, so the image cannot run `prisma migrate` (review of
# treklink-web#431). The generated client and its query engine come from the build stage.
RUN npm ci -w backend --omit=dev --no-audit --no-fund && npm cache clean --force \
  && rm -rf node_modules/prisma node_modules/.bin/prisma node_modules/@prisma/engines \
    node_modules/@prisma/fetch-engine \
  && mkdir -p backend/node_modules

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
# The code stays owned by root and read-only to the `node` user that runs it (review of treklink-web#431).
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/backend/node_modules ./backend/node_modules
# The generated Prisma client and its query engine for this platform.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
WORKDIR /app/backend
# HANDOVER_NOTE_STORAGE_DIR (relative to the working directory) must be writable when the file store is
# chosen; the field host sets HANDOVER_NOTE_STORE=database, so this stays empty there.
RUN mkdir -p storage && chown node:node storage
USER node
EXPOSE 3000
# 200 when the database answers (platform api-design 01); a broker that is down still answers 200 with
# status "degraded", so the container is not restarted for a broker outage.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT_BACKEND||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
# Run it with an init process (`init: true` in deploy/aws/compose.yml, `docker run --init`), so the
# SIGTERM of `docker compose stop` reaches Node and zombies are reaped.
CMD ["node", "dist/main"]
