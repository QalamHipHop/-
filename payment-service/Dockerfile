# =============================================================================
#  RIAL payment-service — multi-stage Dockerfile
#  Author: Qalamhiphop
# =============================================================================
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate \
    && (pnpm install --frozen-lockfile || pnpm install)

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate \
    && pnpm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PAYMENT_HTTP_PORT=50055 \
    PAYMENT_GRPC_PORT=50056
RUN apk add --no-cache wget
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/proto ./proto
COPY package.json ./
EXPOSE 50055 50056
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:50055/healthz/live || exit 1
CMD ["node", "dist/main.js"]
