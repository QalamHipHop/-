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
- `POST /v1/credit` — body: `{ user_id, amount, type, idempotency_key, ... }`
- `POST /v1/debit`
- `POST /v1/transfer`
- `POST /v1/withdraw`
- `POST /v1/withdraw/:id/sign`  (X-Signer-Id header)
- `GET  /v1/accounts/:user_id/transactions?limit=&offset=`

## gRPC
See `proto/wallet.proto`. Generated stubs land in `proto/`.

## Money
All amounts are **int64 minor units (8 dp)**, e.g. `1_00000000` = 1 RIAL.
