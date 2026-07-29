# =============================================================================
#  RIAL payment-service — multi-stage Dockerfile
#  Author: QalamCode
# =============================================================================
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate \
    && (pnpm install --frozen-lockfile || pnpm install)

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate \
    && pnpm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PAYMENT_HTTP_PORT=50055 \
    PAYMENT_GRPC_PORT=50056
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
EXPOSE 50055 50056
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:50055/healthz/live || exit 1
CMD ["node", "dist/main.js"]
