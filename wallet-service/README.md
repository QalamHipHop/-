# wallet-service (Go)

The wallet & custody service. Owns the `wallet` schema (per ADR-0001).

## Responsibilities
- **Accounts**: per-user, internal (reserve, treasury, hot, cold, escrow)
- **Transactions**: double-entry, idempotent on `(account_id, idempotency_key)`
- **Withdrawals**: multi-sig collection, lifecycle, on-chain broadcast hook
- **Outbox + audit mirror**: every credit/debit writes a `shared.outbox` row + audit hash chain
- **Custody**: pluggable signer (memory | vault | aws-kms | gcp-kms)

## Endpoints (HTTP)
- `GET  /v1/accounts/:user_id`
- `POST /v1/credit` — internal-only single-account credit for explicitly authorized platform operations; it is not the fiat-deposit boundary.
- `POST /v1/settle-deposit` — body: `{ user_id, amount, reference, idempotency_key, metadata }`; atomically transfers already-cleared reserve funds to the user account. Payment-service must use this endpoint after provider verification.
- `POST /v1/settle-trade` — body: `{ buyer_id, seller_id, notional, buyer_fee, seller_fee, reference, idempotency_key, metadata }`; captures buyer pending RIAL and atomically distributes seller net proceeds plus treasury fees. Amounts are decimal strings at the HTTP boundary.
- `POST /v1/accounts/:user_id/reserve` and `POST /v1/accounts/:user_id/release` — body: `{ user_id, amount, reference, idempotency_key, metadata }`; move RIAL between available and pending without changing total balance.
- `POST /v1/debit`
- `POST /v1/transfer`
- `POST /v1/withdraw`
- `POST /v1/withdraw/:id/sign`  (X-Signer-Id header)
- `GET  /v1/accounts/:user_id/transactions?limit=&offset=`

## gRPC
See `proto/wallet.proto`. Generated stubs land in `proto/`.

## Money
All amounts are **int64 minor units (8 dp)**, e.g. `1_00000000` = 1 RIAL.
