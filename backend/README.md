# @rial/backend — API Gateway

NestJS-based BFF exposing **REST + GraphQL Federation + WebSocket** for the RIAL platform.

## Architecture
- **HTTP**: Fastify adapter (high throughput, low overhead)
- **GraphQL**: Apollo Server v4, code-first schema, WS subscriptions via `graphql-ws`
- **Auth**: JWT (HS256/RS256), short-lived access + rotating refresh in Redis
- **Persistence**: PostgreSQL via `pg` pool, owned `backend` schema + cross-schema reads on `auth`/`shared`
- **Cache / Locks / Idempotency**: Redis
- **Event bus**: NATS JetStream (publish only here; consumers live in each service)
- **Audit**: Kafka (hash-chained per ADR-0008)
- **Observability**: pino logs, OpenTelemetry traces, /healthz + /readyz

## Run

```bash
# install
pnpm install

# dev (with watch)
pnpm run start:dev

# prod
pnpm run build && pnpm run start:prod
```

## Endpoints
- `GET  /healthz`         — liveness
- `GET  /readyz`          — readiness (db, redis, nats)
- `GET  /docs`            — Swagger UI (dev only)
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET  /api/v1/auth/me`
- `GET  /api/v1/users/me`
- `GET  /api/v1/settlement/info`
- `GET  /api/v1/settlement/rate`
- `POST /graphql`         — GraphQL Federation
- `WS   /graphql`         — subscriptions
- `WS   /ws`              — raw WebSocket fan-out
- `GET  /metrics`         — Prometheus (TODO: wire in @willsoto/nestjs-prometheus)

## Env
See root `.env.example` for the full list. Required:
- `POSTGRES_*`, `REDIS_*`, `NATS_SERVERS`, `KAFKA_BROKERS`, `JWT_SECRET`
