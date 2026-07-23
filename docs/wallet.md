# Wallet System

> Internal, hot, cold, treasury, multi-sig, recovery. Single source of truth: `wallets.ledger_entries` (double-entry).

## Account model

| Account type | Owner         | Purpose                                         |
|--------------|---------------|-------------------------------------------------|
| `user`       | user          | End-user spendable balance                      |
| `hot`        | service       | Operational liquidity (capped)                  |
| `cold`       | service       | Long-term storage (air-gapped)                  |
| `treasury`   | platform      | Fees, rewards, surplus                          |
| `fee`        | platform      | Per-fee-kind buckets for accounting             |
| `reward`     | platform      | Referral/campaign rewards                       |

Each account has a `currency` (`RIAL` = internal `﷼`, or chain symbol for external).
Each user can have many `currency` accounts; UI shows the consolidated `﷼` view by default.

## Balance fields

For every account we track:
- `available_minor` — spendable right now.
- `pending_minor`   — locked by an in-flight action (e.g. deposit confirmation).
- `reserved_minor`  — held against open orders or vesting cliffs.

`balances` is a snapshot. Authoritative state is the `ledger_entries`.

## Internal vs external

- **Internal** — value lives only inside the platform, denominated in `﷼`. Transfers are ledger entries.
- **External** — value on a real chain. Anchored to a private key controlled by `wallet-service`.
  - For external withdrawals we sign and broadcast via the appropriate chain adapter.

## Hot wallet

- Single key, held in KMS/HSM.
- Balance capped (`HOT_WALLET_MAX_MINOR`).
- Auto-sweep to cold when above threshold.
- All operations go through a dedicated gRPC service.

## Cold wallet

- Air-gapped signer; reachable only via multi-sig proposal.
- Public address is whitelisted; only the multi-sig contract can move funds.
- Used for: bulk withdrawals, treasury ops, incident response.

## Multi-sig proposals

- `wallets.multisig_proposals` stores pending transactions.
- Signers submit partial signatures (`wallets.multisig_signatures`).
- Once `threshold` is met, the proposal is broadcast.
- Expiry: defaults to 7 days; configurable per proposal.

## Recovery

- **User recovery**: 2-of-3 social + crypto. The platform stores an encrypted Shamir share on the user device; the other 2 are held by trusted contacts the user designates. Reconstruction requires 2 of 3.
- **Institutional recovery**: Shamir shares printed at onboarding, kept in safe deposit boxes; reconstruction ceremony documented in `docs/runbooks/recovery.md`.
- **Platform recovery**: master key in HSM with quorum of 5 custodians, M-of-N signing.

## Transaction history

- `wallets.transactions` is a denormalized view of ledger entries that hit user accounts.
- Indexed by `(user_id, created_at DESC)`.

## Rate limits

- Withdrawals: per-user per-day cap (configurable by KYC level).
- Per-asset minimum/maximum amount.
- New payees require email/SMS confirmation and a 24h cool-down (configurable).

## Security

- All balance changes are written in the same transaction as the ledger entry.
- Outbox row is emitted in the same transaction → audit-relay guarantees ordering.
- Idempotency keys are required on every write.
- All RPCs require mTLS + JWT.
