# Working Line-by-Line Audit — ﷼ Platform

**Revision reviewed:** `a6cd752`  
**Scope status:** In progress. This file records only findings confirmed by direct source review; it is not a release approval.

## Confirmed findings: financial, ledger, launchpad, matching

| ID | Severity | Location | Confirmed condition and effect |
|---|---|---|---|
| FIN-001 | Critical | `wallet-service/internal/api/routes.go:51-63,79-145` | Credit, debit, transfer, withdrawal, withdrawal signing, account lookup, and transaction history are exposed without authentication or service-to-service authorization. Caller-controlled `user_id` values select the account. In the current development Compose, this service is host-published. An unauthenticated caller can mint internal credit, debit another user, inspect transactions, request withdrawals, or add arbitrary signer IDs. |
| FIN-002 | Critical | `wallet-service/internal/api/routes.go:130-142`; `wallet-service/internal/ledger/withdrawal.go:78` | The HTTP handler creates a withdrawal service with a `nil` custody signer and then calls `Sign`; a threshold-reaching request dereferences `w.signer` and can panic. The signer identity is caller-controlled (`X-Signer-Id`) and defaults to `node-1`. |
| FIN-003 | Critical | `wallet-service/internal/ledger/withdrawal.go:30-95` | Withdrawal requests do not enforce idempotency despite accepting an idempotency key; the key is stored only in metadata. `Sign` has no row lock/optimistic guard, so concurrent signatures can overwrite each other. Its generated `tx_hash` is a local SHA-256 digest, not a chain transaction, and no broadcast occurs. |
| FIN-004 | High | `wallet-service/internal/ledger/withdrawal.go:98-112` | `Confirm` reduces pending balance and marks confirmed without checking status, chain confirmation, transaction hash validity, or a unique confirmation transition. If invoked more than once it can reduce pending repeatedly. |
| FIN-005 | High | `wallet-service/internal/ledger/service.go:188-201,280-290` | The code computes `prevHash` then stores the new linked digest in the `prev_hash` columns of outbox and audit rows. This breaks the ability to traverse or independently verify the intended hash chain. |
| FIN-006 | High | `wallet-service/internal/ledger/service.go:242-275` | Transfers use `applyWithinTx`, which does not write the outbox or audit record despite the service invariant at lines 4-7. Transfer also lacks replay-return idempotency handling. |
| FIN-007 | High | `launchpad-service/internal/api/server.go:34-46,70-191` | All create/approve/reject/pause/buy/sell routes are unauthenticated and trust body-supplied `creator_id`, `actor_id`, and `user_id`. A caller can approve, pause, or trade as another UUID. Several route IDs ignore UUID parse errors. |
| FIN-008 | High | `launchpad-service/internal/launch/service.go:99-107` | The AI risk gate is explicitly fail-open: any scoring transport/error logs a warning and creation continues. This conflicts with a fail-closed risk policy. |
| FIN-009 | High | `launchpad-service/internal/launch/service.go:121-132`; `internal/store/postgres.go:44-50` | Token, bonding state, and vesting schedules are persisted with independent queries. The available transaction helper is not used. Mid-flow failures leave partial token state. |
| FIN-010 | High | `launchpad-service/internal/launch/service.go:211-265,308-337`; `internal/store/redis.go:26-33` | Settlement happens in wallet before non-atomic holder/bonding/trade-request updates. Compensation is best-effort. A process crash can leave debit/credit detached from ownership state. The Redis lock has a fixed five-second lease and unconditional delete, so an expired/reacquired lock may be released by an old owner. |
| FIN-011 | High | `launchpad-service/internal/curve/engine.go:102-122`; `launchpad-service/internal/launch/service.go:376-384` | `State.model()` always returns an empty string. Therefore `SpotPriceFor` always returns unsupported model; `priceImpactBps` sees zero price and returns zero. Published price-impact/spot-price behavior is incorrect. |
| FIN-012 | High | `launchpad-service/internal/curve/engine.go:79-89,136-193` | Curve validation omits model-specific constraints (e.g., positive base price, nonnegative slope, finite exponential inputs). Quote math uses `float64`, ignores integration errors, and does not enforce a clear rounding policy. It cannot uphold the stated deterministic/cross-chain precision guarantee. |
| FIN-013 | High | `launchpad-service/internal/curve/engine.go:139-171` | Buy reserve adds the gross input while integration uses post-fee effective input; sell reserve subtracts gross curve area while no fee recipient/accrual exists. Fee ownership and pool accounting are inconsistent and no treasury credit is recorded. |
| FIN-014 | Critical | `matching-engine/src/orderbook.rs:17-19`; `matching-engine/src/matcher.rs:175-184` | The opposite order book is iterated in ascending `BTreeMap` order for both sides. A sell taker consumes the lowest bid first, not the highest bid, violating best execution and price priority. FOK `peek_fillable` has the same ordering fault. |
| FIN-015 | Critical | `matching-engine/src/service.rs:101-149`; `decimal.rs:10-12`; `service.rs:161-200` | RPC order conversion uses `expect`-based decimal parsing, so malformed numeric input can panic the process. It accepts caller-supplied order IDs, user IDs, filled quantity, and market without authorization/positive-value validation. `cancel_order` does not authenticate or verify order ownership. |
| FIN-016 | High | `matching-engine/src/service.rs:250-269` | Both stream RPCs are explicit placeholders that return closed streams; there is no emitted real-time book or trade feed. Engine orderbook state is in-memory only and has no persistence/recovery. |
| FIN-017 | Critical | `backend/src/modules/trading/trading.service.ts:155-164,301-303` | With external matching enabled, orders are merely published and `applyExternalTrade` only logs events. No fills, balances, fees, or persisted trade state are applied. |
| FIN-018 | Critical | `backend/src/modules/trading/trading.service.ts:221-299` | The fallback matcher fabricates a trade using the taker as both buyer and seller. It does not load a maker order or settle a counterparty; this cannot represent a real exchange trade. |
| FIN-019 | High | `backend/src/modules/trading/trading.service.ts:339-345` | A market buy estimates escrow from the current best ask; an empty book returns zero and locks no quote balance. No explicit slippage/max-spend field is required. |
| FIN-020 | High | `backend/src/modules/wallet/wallet.repository.ts:80-96` | `adjustAvailable` permits a negative available balance because its SQL update has no `available_minor + delta >= 0` guard. The Nest wallet path and Go wallet service use different schemas and invariants. |
| EVM-001 | Critical | `smart-contracts/contracts/security/AccessControl.sol:31-37,50-67` | `grantRole` and `revokeRole` never check the caller against the role admin. Any account can grant a new role to any account or revoke an existing role; the condition is inverted around the result of `_grantRole`/`_revokeRole`. This compromises every role-gated function in `RialToken`. |
| EVM-002 | High | `smart-contracts/contracts/core/RialToken.sol:20-33` | `RialToken` has unrestricted privileged mint/burn under roles and no supply cap, oracle/backing proof, timelock, or multisig enforcement. Combined with EVM-001 it is unsafe to deploy. |

## Immediate no-go scope

These confirmed findings alone make the current financial wallet, withdrawal, central-limit-order trading, and EVM token deployment paths **unsafe for real customer balances or public Mainnet operation**. The existing zero-supply Solana unsigned-mint builder is separately reviewed in a later audit section; this statement does not claim it broadcasts any transaction.

## Confirmed findings: gateway and frontend

| ID | Severity | Location | Confirmed condition and effect |
|---|---|---|---|
| UI-001 | High | `frontend/src/app/portfolio/page.tsx:24-53` | If the portfolio or wallet request fails, the signed-in user is shown fixed fake positions and a fixed RIAL balance of 5,000/5,240. This is indistinguishable from real holdings in the rendered portfolio and violates the no-synthetic-data requirement. |
| UI-002 | High | `frontend/src/app/portfolio/page.tsx:119-127` | Open orders and history always render “No open orders” / “No recent trades”; they do not call the real authenticated trading endpoints. |
| UI-003 | High | `frontend/src/app/trade/[symbol]/page.tsx:56-58,212-215,275-307` | The trade detail page falls back to generated token metadata, random holder addresses, and random OHLC candles when requests fail. It therefore can present fabricated market data as a real trading view. |
| UI-004 | High | `frontend/src/components/market/token-ticker.tsx:13-32` | Ticker starts from fixed sample assets and mutates price/change with `Math.random`; it is not a market-data feed. |
| UI-005 | High | `frontend/src/lib/api.ts:33-45`; `frontend/src/components/auth/auth-provider.tsx:62-73` | Access tokens are stored in `localStorage` and automatically attached as Bearer headers. Any successful same-origin script injection can extract the token; the client also sends cookies (`credentials: include`) without an explicit anti-CSRF header policy. |
| GW-001 | Medium | `backend/src/common/guards/jwt-auth.guard.ts:45` | The guard returns `true` for every non-HTTP/non-WebSocket execution context. It provides no authentication boundary for RPC/microservice contexts if controllers or handlers rely on it there. |
| GW-002 | Medium | `backend/src/config/auth.config.ts:25-44` | Development permits a fixed, publicly known JWT secret. Production rejects an empty secret, but there is no length/entropy validation and no enforced asymmetric-key requirement. |
| GW-003 | High | `backend/src/modules/trading/trading.service.ts:100-108`; `trading.controller.ts:76-79` | Market creation accepts unvalidated string tick/lot quantities and uses `@Roles('admin')`; the supplied guard only enforces role claims if it is globally registered. The controller itself does not apply `JwtAuthGuard` to this route. Global registration must be demonstrated before this can be considered protected. |

## Scope note

The frontend findings above are confirmed directly from source. They are independent of whether a local developer runtime happens to show a successful API response: every cited fallback is activated precisely when the real dependency fails.

## Confirmed findings: Solana, payments, deployment, and configuration

| ID | Severity | Location | Confirmed condition and effect |
|---|---|---|---|
| SOL-001 | Medium | `frontend/src/app/api/solana/mint-plan/route.ts:66-143` | The unsigned-mint builder is publicly callable for any owner address and lacks authentication, origin binding, rate limiting, request-size limits, and abuse protection. It does not receive a user private key and does not broadcast, which are positive safeguards, but a public caller can consume Mainnet RPC capacity and obtain signed mint-account plans. |
| SOL-002 | Medium | `frontend/src/app/api/solana/mint-plan/route.ts:94-140` | The builder creates a standard SPL mint/ATA plan with zero supply but does not simulate the final transaction, bind the plan to an authenticated user/session, publish canonical token metadata, validate an image URI, or record an approval/audit trail. It intentionally omits metadata and liquidity; it is a ceremony component, not a finished token-launch adapter. |
| SOL-003 | Medium | `frontend/src/app/launchpad/mainnet-mint/page.tsx:59-79` | After Phantom returns a signature, the UI performs only one immediate verifier request. It does not poll confirmation/finality, persist the signature, link the mint to an approved launchpad record, or prove that the Phantom-returned signature corresponds to the displayed plan after expiry/rebuild. |
| PAY-001 | Critical | `payment-service/src/intents/intent.store.ts:22-70` | Payment intents and idempotency are held exclusively in process-local `Map` objects. A restart loses payment records and deduplication, and multiple replicas diverge. This payment service is not a durable production payment system. |
| PROD-001 | Critical | `docker-compose.yml:21-212`; `payment-service/src/config/configuration.ts:86`; `backend/src/config/auth.config.ts:32`; `launchpad-service/internal/config/config.go:98` | Base runtime publishes infrastructure and mutation-service ports to all host interfaces and supplies known development defaults (`change-me`, memory custody, insecure JWT/internal service token defaults, anonymous Grafana, development search). The production overlay is optional; launching base Compose remains unsafe. |
| PROD-002 | High | `docker-compose.yml:73`; `wallet-service/internal/custody/memory.go:14-41`; `wallet-service/internal/config/config.go:179` | MinIO uses a floating `latest` image tag. Wallet custody defaults to ephemeral in-memory keys generated at process start; no persistent KMS/HSM, policy-managed signer identity, or operational multisig exists. |
| PROD-003 | High | `docker-compose.production.yml:4-60`; `scripts/validate-production-env.sh:18-51` | The overlay and validator improve deployment hygiene, but they are controls that must be invoked manually. They do not provision TLS, enforce a secret manager, protect application service-to-service calls, or make an existing base-Compose deployment production-safe. |

## Corrections from cross-checking

The gateway does register `JwtAuthGuard` globally (`backend/src/app.module.ts:97-98`) and the trading/wallet modules register `RolesGuard`. The audit therefore does **not** classify market creation as unauthenticated solely from its controller annotation. The remaining findings on trading execution, wallet data integrity, and external matching are independent of that protection.

## Reproduced compiler failure

`npm test` from `smart-contracts/` was executed after isolated dependency installation. Hardhat downloaded the configured Solidity compiler and failed before any test could run:

```text
DeclarationError: Undeclared identifier.
contracts/vesting/VestingWallet.sol:40:20
_grantRole(DEFAULT_ADMIN_ROLE, admin);
```

| ID | Severity | Location | Confirmed condition and effect |
|---|---|---|---|
| EVM-003 | Critical | `smart-contracts/contracts/vesting/VestingWallet.sol:39-42`; `contracts/security/AccessControl.sol:9-74` | The custom `AccessControl` contract does not declare `DEFAULT_ADMIN_ROLE`, but `VestingWallet` references it. The entire Hardhat contract suite fails at compilation; smart contracts cannot be built, tested, or deployed from this revision. |
| EVM-004 | High | `smart-contracts/contracts/vesting/VestingWallet.sol:65-94` | `releasable` can underflow if `released > vested` due to a malformed/changed schedule; revocation returns all `total - released` to the current administrator rather than an explicitly configured treasury, and no schedule-existence or cliff-vs-duration validation is enforced. |

## Test-environment limitation

The repository contains `matching-engine/tests/matching.rs` and `trading-engine/tests/trading.rs`, but the sandbox image does not provide the Rust `cargo` toolchain (`cargo: command not found`). No Rust test result is therefore claimed in this audit. FIN-014 through FIN-016 remain **source-confirmed** findings, with exact code paths cited above, rather than runtime-reproduced test outcomes.
