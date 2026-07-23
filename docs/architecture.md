# System Architecture — ﷼ Platform

> Status: living document. See `adr/` for individual decisions.

## 1. Goals

- **Production-grade** token launch & trading platform supporting millions of users.
- **Modular** — every domain (wallet, trading, launchpad, payments, AI) is a separate service with a clean contract.
- **Pluggable** — payment, KYC, custody, and chain integrations are adapters behind stable interfaces.
- **Pluggable settlement** — internal unit is `﷼`. Exchange-rate strategy is configurable (fixed | floating | external), never assumed pegged.
- **Compliance-ready** — every state-changing action goes through an audit log and policy engine.

## 2. High-level Topology

```
                       ┌─────────────────────────┐
                       │  Clients (Web / Mobile) │
                       └────────────┬────────────┘
                                    │ HTTPS / WSS
                              ┌─────▼─────┐
                              │   Nginx   │  WAF, rate-limit, TLS
                              └─────┬─────┘
                                    │
                          ┌─────────▼──────────┐
                          │  API Gateway (Go)  │  auth, routing, idempotency
                          └─────────┬──────────┘
                                    │
        ┌──────────┬──────────┬─────┴─────┬──────────┬──────────┐
        │          │          │           │          │          │
   ┌────▼───┐ ┌────▼────┐ ┌───▼────┐ ┌────▼───┐ ┌────▼───┐ ┌────▼────┐
   │ Auth   │ │ Wallet  │ │Trading │ │Launch  │ │Payment │ │ ...     │
   │  (TS)  │ │  (Go)   │ │ (Rust) │ │ (Go)   │ │  (TS)  │ │         │
   └────┬───┘ └────┬────┘ └───┬────┘ └────┬───┘ └────┬───┘ └────┬────┘
        │          │          │           │          │          │
        └──────────┴──────────┴─────┬─────┴──────────┴──────────┘
                                    │
                ┌───────────────────┼───────────────────┐
                │                   │                   │
          ┌─────▼─────┐      ┌──────▼──────┐     ┌──────▼──────┐
          │ PostgreSQL │      │   Redis     │     │ ClickHouse  │
          │ (primary)  │      │ (cache+lm)  │     │ (analytics) │
          └────────────┘      └─────────────┘     └─────────────┘
                                    │
                          ┌─────────▼──────────┐
                          │  NATS JetStream    │  event bus
                          │  Kafka (audit)     │  immutable log
                          └────────────────────┘
```

## 3. Service Catalog

| Service            | Lang     | Responsibility                                                                 |
|--------------------|----------|--------------------------------------------------------------------------------|
| `frontend`         | TS/Next  | Public + admin UI, SSR, RTL/i18n, trading terminal                             |
| `backend` (gateway)| TS/Nest  | GraphQL federation, REST, WS fan-out, BFF                                     |
| `auth`             | TS/Nest  | Email/phone/OAuth/wallet/passkeys/2FA, sessions, RBAC                          |
| `wallet-service`   | Go       | Internal/hot/cold/treasury, multi-sig, signing, ledger                         |
| `payment-service`  | TS/Nest  | Pluggable payment adapters, fiat → ﷼ credit, webhooks                          |
| `launchpad-service`| Go       | Token wizard, bonding curve, graduation, vesting                               |
| `matching-engine`  | Rust     | Order book, matching, partial fills, settlement                                |
| `trading-engine`   | Rust     | Order routing, smart routing, market making, risk checks                       |
| `dex` (on-chain)   | Sol/Anc  | Smart contracts: AMM, factory, router, vesting                                 |
| `notification`     | TS/Nest  | Push, SMS, email, Telegram, Discord, WS                                        |
| `analytics`        | TS/Nest  | Real-time stats, dashboards, exports                                           |
| `ai-engine`        | Py+Rs    | Fraud/spam/bot/wash-trading, risk scoring, recommendations                     |
| `moderation`       | TS/Nest  | Scam/fake-token detection, image/text moderation                               |

## 4. Data Plane

- **PostgreSQL 16** — system of record. Per-service schemas; cross-service writes go through APIs or outbox + NATS, never direct.
- **Redis 7** — cache, locks, rate-limit counters, leaderboard sets, idempotency keys.
- **ClickHouse** — analytics events, OHLCV, order book history.
- **Elasticsearch** — full-text search, audit log indexing.
- **MeiliSearch** — fast product/UI search (lighter than ES for faceting).
- **MinIO (S3)** — public assets (logos, banners) + private encrypted artifacts.

## 5. Streaming & Async

- **NATS JetStream** — internal event bus (lightweight, low-latency).
- **Kafka** — append-only audit log, replayable history of every state change.
- **WebSocket gateway** — fan-out to clients (subscriptions per topic, JWT-bound).

## 6. Settlement Token (`﷼`)

- `SETTLEMENT_TOKEN_SYMBOL=RIAL`, name + ticker both render as `﷼`.
- `EXCHANGE_RATE_STRATEGY ∈ {fixed, floating, external}`.
- `RateProvider` interface in `payment-service`. Implementations:
  - `FixedRateProvider` — uses `EXCHANGE_RATE_FIXED`.
  - `ExternalRateProvider` — polls `EXCHANGE_RATE_EXTERNAL_URL` every `EXCHANGE_RATE_REFRESH_SEC`, signed, cached in Redis.
  - `FloatingRateProvider` — internal order-book-derived (future).
- Every `﷼` value is stored as **bigint minor units** (8 dp) to avoid float drift.

## 7. Security Architecture

- **Zero-trust** — every service-to-service call is mTLS + JWT.
- **WAF** at Nginx + Cloudflare in prod.
- **Rate limit** per IP, per user, per route.
- **Idempotency-Key** required on all POSTs (24h replay window).
- **Audit log** — every state change emitted to Kafka with signed hash chain.
- **Encryption at rest** — Postgres TDE, MinIO SSE-KMS, app-level field encryption for PII.
- **Signing keys** in HashiCorp Vault or cloud KMS, never in env in prod.
- **Bug-bounty ready** — strict CSP, sandboxed iframes for token previews.

## 8. Scalability

- Every service is stateless; horizontal scale via K8s HPA on CPU + custom metrics (RPS, queue depth).
- Postgres uses read replicas; write path is single primary with logical replication to ClickHouse.
- Caching layers: edge (Cloudflare), Nginx microcache, Redis app cache.
- Matching engine pinned to dedicated nodes with kernel-bypass (DPDK) option.

## 9. Deployment

- Dev: `make up` (Docker Compose).
- Prod: Helm chart in `infrastructure/kubernetes/helm/`, deployed via ArgoCD or GitHub Actions.
- One-command installer (`installer/install.sh`) bootstraps K8s cluster (or VM-based bare-metal).

## 10. Observability

- **OpenTelemetry** traces across all services.
- **Prometheus** metrics + alert rules in `infrastructure/monitoring/alerts/`.
- **Grafana** dashboards provisioned automatically.
- **Loki** for logs, **Tempo** for traces.
- **Health endpoints** `/healthz`, `/readyz` on every service.

## 11. Disaster Recovery

- RPO ≤ 5 min, RTO ≤ 30 min.
- Postgres: continuous WAL archiving to S3 + PITR.
- Cross-region replication for read replicas.
- Documented runbooks in `docs/runbooks/`.

## 12. ADRs (Architecture Decision Records)

| ID  | Title                                          | Status   |
|-----|------------------------------------------------|----------|
| 001 | Monorepo with per-service boundaries           | Accepted |
| 002 | Pluggable payment adapters via PaymentGateway  | Accepted |
| 003 | `﷼` as internal unit, configurable FX         | Accepted |
| 004 | Rust for latency-critical paths                | Accepted |
| 005 | GraphQL Federation + REST + gRPC + WS          | Accepted |
| 006 | NATS JetStream for internal bus, Kafka for audit| Accepted |
| 007 | PostgreSQL as system of record                 | Accepted |
| 008 | Audited, hash-chained event log                | Accepted |
