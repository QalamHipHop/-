# Production-Readiness Audit — ﷼ Rial Platform

**Status:** In remediation — **NO-GO** for public production rollout or Solana Mainnet token mint.  
**Author:** Qalamhiphop  
**Audit timestamp:** 2026-08-15  
**Repository baseline:** `a2603a1` plus uncommitted remediation work in this audit session.

> This report separates verified runtime behavior from source-level claims. A service shown as healthy is not, by itself, evidence that every user-facing or financial workflow is production-ready.

## Executive conclusion

The platform has a working internal development runtime: the primary containers start, the gateway, wallet, launchpad, payment, notification, analytics, AI engine, and matching engine health endpoints answered successfully during this audit. The internal wallet-ledger-to-launchpad buy/sell lifecycle is operational and retry-safe.

However, the repository and runtime do **not** yet meet the requested standard of a complete, fault-free, real production platform. The most material gaps are an unimplemented Solana Mainnet deployment adapter, remaining mock-backed frontend pages, missing gateway support for launchpad creation, development-grade runtime secrets and network exposure, an unsynchronized analytics lockfile, and incomplete public deployment controls. Mainnet minting must remain blocked until the Mainnet-specific gaps are closed and an explicit transaction scope is approved by the owner.

## Evidence matrix

| Area | Evidence and result | Status |
|---|---|---|
| Core runtime | PostgreSQL, Redis, NATS, Kafka, frontend, backend, wallet, launchpad, payment, notification, AI, matching, trading, Meilisearch, and MinIO were observed running at audit time. | Partially verified |
| HTTP health | Frontend, gateway readiness, wallet readiness, launchpad health, payment liveness, notification health, analytics readiness, AI health, and matching internal health returned `200`/healthy before remediation. | Verified |
| Engine connectivity | Host TCP listeners on 50051–50058 were reachable; matching internal `/healthz` returned `ok`. | Verified |
| Ledger lifecycle | `scripts/e2e-launchpad-ledger.sh` completed against live local services: development credit, token record creation, approval, buy, and wallet trade settlement. | Verified — internal only |
| Retry safety | Audit-only buy and sell requests repeated with the same `client_id` produced byte-identical responses and the same persisted `trade_id` for each retry. | Verified — internal only |
| Kafka audit | Prior to remediation, launchpad wrote to nonexistent `rial.launchpad` and logged `Unknown Topic Or Partition`. The producer now uses configured `rial.launches.v1`; a new `token.created` event and a trade payload were consumed from that topic after an E2E run. | Remediated and verified |
| AI moderation | Prior to remediation, launchpad called `/v1/risk/token` while AI offered only `/score/*`, causing a `404` and fail-open token creation. Versioned compatibility routes have been added and directly returned structured scores. A post-remediation E2E run showed no AI contract warning. | Remediated and verified |
| Gateway market API | `TradingModule` and `WalletModule` were missing from `AppModule`, producing `404` responses. They are now imported. Read-only market routes were deliberately marked public; `/api/v1/trading/markets` returns `200`. | Remediated and verified |
| Real market data | The public market endpoint currently returns an empty array. No live on-chain market, external liquidity, or completed market seed was found. | Incomplete |
| Launchpad UI | Listing and detail pages still contain `SAMPLE` / `FALLBACK` data; the detail page expects symbol-based endpoints that the actual launchpad service does not expose. | Blocker |
| Launchpad gateway API | The frontend calls `/api/launchpad/tokens`, but the gateway has no launchpad module or secure owner-aware proxy. The direct Go service requires fields that the frontend launch form does not provide. | Blocker |
| Solana Mainnet | The configured Solana RPC returned the Devnet genesis hash. No versioned SPL, Anchor, Metaplex, or Solana chain-adapter implementation exists in the repository. | Blocker |
| Mainnet ownership | The provided Phantom public address was validated on Solana Mainnet and has sufficient SOL for the previously calculated mint-account cost basis. No private key was requested, stored, or used. | Ready only for a future signing flow |
| Runtime secrets | The local runtime uses known insecure defaults for PostgreSQL, Redis, ClickHouse, MinIO, JWT, and CSRF; Meilisearch master key is absent. Backend is running in development mode. | Blocker |
| Network perimeter | Docker Compose publishes data stores and internal services on all host interfaces. Nginx, TLS certificates, Grafana, Prometheus, Loki, OTEL collector, and Elasticsearch were not running at baseline. | Blocker |
| Image hardening | Several service images lack a non-root `USER` directive, including AI, matching, and trading engines. | High priority |
| Reproducible tests | The workspace lockfile was synchronized without lifecycle scripts. A frozen analytics install succeeded; analytics, backend, notification, and payment test suites passed (57 tests in 10 suites). Backend, frontend, and payment typechecks passed. The final recursive test wrapper did not return control after all suites reported success, so CI must enforce a bounded test timeout and preserve the complete logs. | Partially verified |

## Remediation applied in this audit

| Change | Files | Verification |
|---|---|---|
| Register trading and wallet modules in API gateway | `backend/src/app.module.ts` | Gateway restarted; `/api/v1/trading/markets` exists. |
| Make read-only market endpoints public while keeping orders and market creation protected | `backend/src/modules/trading/trading.controller.ts` | Unauthenticated `GET /api/v1/trading/markets` returns `200`; write endpoints remain guarded. |
| Normalize frontend `/api/...` calls to gateway `/api/v1/...` | `frontend/src/lib/api.ts` | Frontend TypeScript typecheck passed. |
| Repair launchpad Kafka producer configuration | `launchpad-service/internal/event/kafka_audit.go`, `launchpad-service/cmd/launchpad/main.go`, `launchpad-service/internal/config/config.go` | E2E launch and trade events consumed from `rial.launches.v1`. |
| Add AI compatibility risk endpoints required by launchpad | `ai-engine/src/api/main.py` | Direct token-risk request returned score/components; post-remediation E2E had no 404 warning. |
| Synchronize workspace lockfile and validate analytics under frozen install | `pnpm-lock.yaml` | Frozen analytics install and its Jest suite passed. |

## Production blockers and required closure criteria

| ID | Blocker | Closure criterion |
|---|---|---|
| P0-1 | No Mainnet Solana adapter | Add versioned transaction builder, Phantom-compatible unsigned signing handoff, SPL mint/ATA/metadata support, persisted transaction audit, and on-chain verification. |
| P0-2 | Mock launchpad UI and unavailable secure launchpad gateway route | Replace `SAMPLE` and `FALLBACK` rendering with real data; add a secure authenticated gateway adapter that binds creator identity to the JWT and records only verified mint addresses. |
| P0-3 | Development secrets and exposed infrastructure | Rotate all runtime secrets, restrict internal ports to private network/loopback, run backend in production, and configure a secret manager before public exposure. |
| P0-4 | No active TLS/perimeter/observability stack | Configure domain, certificates, reverse proxy, network policy, metrics, logs, alert routing, backup monitoring, and restore test. |
| P1-4 | Test process completion evidence | Run the synchronized workspace suite in CI under a bounded timeout and retain JUnit/log artifacts, because the local recursive wrapper did not return after all suites printed success. |
| P1-1 | Authority governance incomplete | Document backing/issuance policy and transfer Mainnet mint/freeze control to a reviewed multisignature or equivalent before issuance. |
| P1-2 | No real liquidity/market design | Define, approve, fund, and verify an on-chain liquidity and market-creation workflow; do not infer tokenomics from UI sample data. |
| P1-3 | Container hardening gaps | Run every service as non-root, add read-only filesystems/capability drops where compatible, pin image digests, and scan dependencies/images in CI. |

## Mainnet go/no-go

**Decision: NO-GO.** A real Mainnet transaction has not been constructed, signed, or broadcast. The previously prepared zero-supply Rial mint specification remains only a draft. The owner’s private key and seed phrase remain outside this environment.

The next technically correct path is to close P0-1 through P0-5, re-run this audit with a production configuration, then present a simulated, exact-cost unsigned transaction for explicit owner approval and Phantom signing.

## Internal source references

1. [`README.md`](../README.md)
2. [`docs/adr/0003-settlement-token.md`](adr/0003-settlement-token.md)
3. [`docs/deployments/rial-solana-mainnet-spec.md`](deployments/rial-solana-mainnet-spec.md)
4. [`launchpad-service/internal/launch/service.go`](../launchpad-service/internal/launch/service.go)
5. [`launchpad-service/internal/event/kafka_audit.go`](../launchpad-service/internal/event/kafka_audit.go)
6. [`backend/src/app.module.ts`](../backend/src/app.module.ts)
7. [`frontend/src/app/launchpad/page.tsx`](../frontend/src/app/launchpad/page.tsx)
8. [`frontend/src/app/launchpad/[symbol]/page.tsx`](../frontend/src/app/launchpad/[symbol]/page.tsx)
9. [`ai-engine/src/api/main.py`](../ai-engine/src/api/main.py)
