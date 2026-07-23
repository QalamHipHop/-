# ADR-0007: PostgreSQL as System of Record

- Status: Accepted

## Context
We need ACID guarantees, mature tooling, and operational familiarity.

## Decision
PostgreSQL 16 is the system of record. Each microservice owns its schemas and may only read/write its own tables; cross-service writes go through APIs or outbox+stream. ClickHouse is for analytics only and is fed via logical replication or a CDC stream.

## Consequences
- Schema evolution requires coordination. Migrations are versioned and forward-only.
- Read replicas scale reads; heavy aggregation lives in ClickHouse.
