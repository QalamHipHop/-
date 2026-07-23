# ADR-0006: NATS JetStream for Internal Bus, Kafka for Audit

- Status: Accepted

## Context
We need two distinct things from streaming: a low-latency internal event bus for service coordination, and a durable, replayable audit log.

## Decision
- **NATS JetStream** for service-to-service events (domain events, request/reply via subjects).
- **Apache Kafka** as the immutable, hash-chained audit log of every state change.

## Consequences
- NATS gives us microsecond latency, simple subject-based routing, and built-in KV/Object stores.
- Kafka gives us long retention, exactly-once writes, and the ability to reconstruct state.
- A small "event-relay" component forwards from NATS to Kafka for audit.
