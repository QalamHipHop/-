# syntax=docker/dockerfile:1.7
# ============================================================================
#  RIAL — Backend API Gateway (NestJS)
#  Multi-stage, non-root, health-checked.
# ============================================================================

ARG NODE_VERSION=22-alpine

# --- Stage 1: deps (cached) -----------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml* ./
COPY tsconfig*.json nest-cli.json ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --no-frozen-lockfile --ignore-scripts --node-linker=hoisted

# --- Stage 2: build --------------------------------------------------------
FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build || npm run build

# --- Stage 3: runtime (slim) ----------------------------------------------
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    APP_PORT=8080

RUN apk add --no-cache wget tini && \
    addgroup -S rial && adduser -S rial -G rial

COPY --from=build --chown=rial:rial /app/node_modules ./node_modules
COPY --from=build --chown=rial:rial /app/dist ./dist
COPY --from=build --chown=rial:rial /app/package.json ./package.json

USER rial
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://localhost:8080/healthz || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
