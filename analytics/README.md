# Rial Analytics Service

Real-time metrics, charts, and analytics. Built on NestJS, ClickHouse, Redis,
and Kafka. Powers the live stats, top tokens/creators, trending, whales,
heatmaps, and growth dashboards on the front-end.

## Quick start

```bash
npm install
npm run start:dev
# GraphQL Playground: http://localhost:3010/graphql
# Health:           http://localhost:3010/healthz
```

## Endpoints

- `POST /graphql` — GraphQL API
- `GET  /healthz` — liveness
- `GET  /readyz`  — readiness (checks ClickHouse, Redis, Kafka)
- `GET  /metrics` — Prometheus

## Subscriptions (WebSocket)

- `tokenCreated(symbol: String!)` — fires when a new launch goes live
- `tradeFeed(symbol: String!)` — live trades for a token
- `topMovers()` — top-10 movers in the last 5 min

## Data model (ClickHouse)

| Table                | Engine       | Purpose                              |
|----------------------|--------------|--------------------------------------|
| `trades`             | MergeTree    | every trade, append-only             |
| `tokens`             | Replacing    | latest snapshot per token            |
| `candles_1m/5m/1h/1d`| Aggregating  | pre-aggregated OHLCV                 |
| `holders_snapshot`   | Replacing    | holder set per token (hourly)        |
| `user_actions`       | MergeTree    | signup, login, KYC, deposit, etc.    |
| `platform_metrics`   | Aggregating  | global counters (TVL, 24h volume)    |
| `ai_signals`         | MergeTree    | fraud/risk scores from ai-engine     |

## Consumers

- `kafka:rial.trades.v1`     → `trades` table
- `kafka:rial.launches.v1`   → `tokens` table
- `kafka:rial.fees.v1`       → `platform_metrics`
- `kafka:rial.ai.signals.v1` → `ai_signals`
