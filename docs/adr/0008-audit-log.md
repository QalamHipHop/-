# ADR-0008: Audited, Hash-Chained Event Log

- Status: Accepted

## Context
Compliance, fraud detection, and customer disputes all require a tamper-evident history of every state change.

## Decision
Every state change in every service emits an event to a Kafka topic `audit.events` with:
- `id`, `aggregate`, `aggregate_id`, `actor`, `action`, `payload_hash`, `prev_hash`, `ts`, `trace_id`
- `payload_hash = sha256(canonical_json(payload))`
- `prev_hash` references the previous event for the same `aggregate_id`

A daily `audit-checker` job verifies the chain.

## Consequences
- Detects in-place tampering.
- Enables replay into ClickHouse for analytics and into Postgres for disaster recovery.
- Slight write amplification; mitigated by batching in the audit-relay.
