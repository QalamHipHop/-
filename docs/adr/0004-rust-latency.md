# ADR-0004: Rust for Latency-Critical Paths

- Status: Accepted

## Context
Matching, market-making, and order routing are microsecond-sensitive. Garbage-collector pauses in JVM/Node are unacceptable.

## Decision
Matching and trading engines are written in Rust. They communicate via gRPC. Order intake is in the API gateway (Node); once an order passes validation, it is forwarded to the matching engine.

## Consequences
- Higher implementation cost for the team — mitigated by writing the hot paths small and the rest in TS/Go.
- Better tail-latency (p99) and lower memory footprint.
- We can run more book partitions per node.
