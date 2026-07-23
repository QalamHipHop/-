# ADR-0005: GraphQL Federation + REST + gRPC + WebSocket

- Status: Accepted

## Context
Different consumers want different access patterns: REST for ops/SDKs, GraphQL for the web app, gRPC for service-to-service, WS for realtime.

## Decision
- Public API: **REST + GraphQL** (gateway in NestJS).
- Internal RPC: **gRPC** (services in Go, Rust, TS).
- Realtime: **WebSocket** with JWT-bound subscriptions, multiplexed over a single connection.

## Consequences
- Multiple surface areas to maintain, but each is best-in-class for its consumer.
- Strict schema-first design: OpenAPI and GraphQL SDL are source of truth, code is generated.
