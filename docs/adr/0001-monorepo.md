# ADR-0001: Monorepo with per-service boundaries

- Status: Accepted
- Date: 2026-07-23

## Context
We need shared contracts, types, and tooling across ~10 services while keeping deployment units independent.

## Decision
Single git repository with each service as a top-level folder. Shared code lives under `packages/` (TS) and `crates/` (Rust). Turborepo coordinates builds and caches. Each service has its own `Dockerfile` and `package.json` / `Cargo.toml`.

## Consequences
- Easier refactors of shared contracts.
- Single CI pipeline, but per-service deploys.
- Risk: repo size — mitigated via sparse checkouts in IDE and per-service pipelines.

## Alternatives considered
- Polyrepo: rejected — too much overhead for shared types.
- Monolith: rejected — wrong for the latency and scale requirements.
