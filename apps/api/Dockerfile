# syntax=docker/dockerfile:1
# Build context is the repository root: docker build -f apps/api/Dockerfile .

FROM node:22-alpine AS base
RUN npm install -g pnpm@10.28.0
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @cannopy/api...
COPY packages/core packages/core
COPY apps/api apps/api
RUN pnpm --filter @cannopy/core build && pnpm --filter @cannopy/api build
# Produce a self-contained production tree with only runtime dependencies.
RUN pnpm --filter @cannopy/api --legacy deploy --prod /out

FROM node:22-alpine AS runtime
# CI passes the commit SHA so /api/health reports which build is running.
ARG APP_VERSION=dev
ENV NODE_ENV=production APP_VERSION=$APP_VERSION
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
# Run migrations, then start. A failed migration stops the container so Portainer shows it.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
