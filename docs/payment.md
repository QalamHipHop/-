# Payment Abstraction Layer

> **We do not assume any specific banking, card, or PSP integration.** The platform exposes a clean `PaymentGateway` interface; concrete adapters (Stripe, a local shetab processor, a crypto on-ramp, manual bank reconciliation) plug in behind it.

## Goals

- **Provider-agnostic** — add/remove providers without touching domain code.
- **Configurable per tenant** — different regions can enable different providers.
- **Idempotent** — duplicate webhooks never double-credit.
- **Auditable** — every deposit, withdrawal, refund, chargeback is recorded in the audit log.
- **Reconcilable** — daily reconciliation job matches on-chain/off-chain ledger with PSP records.

## Internal settlement

- All in-platform balances are denominated in `﷼` (symbol: `﷼`).
- Every amount is stored as `BIGINT` in **minor units** (1 `﷼` = 100_000_000 minor).
- The `RateProvider` resolves `﷼` ↔ external currency at deposit/withdrawal/display time.
  - `FixedRateProvider` — uses `EXCHANGE_RATE_FIXED`.
  - `ExternalRateProvider` — polls an external feed (e.g. central bank), caches in Redis.
  - `FloatingRateProvider` — internal order-book derived (future).
- Display layer can show `﷼` (internal) or `﷼ ≈ $X.XX` (converted) — never both without clear labeling.

## Interface (TypeScript)

```ts
export interface PaymentGateway {
  readonly name: string;                                  // 'stripe' | 'parsiq' | ...
  createDeposit(input: CreateDepositInput): Promise<DepositIntent>;
  createWithdrawal(input: CreateWithdrawalInput): Promise<WithdrawalIntent>;
  verifyWebhook(headers: Record<string,string>, body: string): WebhookEvent;
  getRate(quote: 'rial_to_fiat'|'fiat_to_rial', fiat: string): Promise<Rate>;
  refund(adapterRef: string, amountMinor: bigint): Promise<RefundResult>;
}
```

## Built-in adapters (examples)

| Adapter         | Region  | Method                        | Notes                            |
|-----------------|---------|-------------------------------|----------------------------------|
| `stripe`        | global  | Card, ACH, SEPA, Apple Pay    | webhook signed via Stripe-Sig    |
| `parsiq`        | IR      | Shetab, card, wallet          | TBD — requires local partner     |
| `crypto-onramp` | global  | USDC/USDT, on-chain transfer  | monitor inbound tx + confirmations |
| `manual-bank`   | any     | Operator-reconciled wire      | admin UI flow + CSV import       |

> **Adapters requiring real credentials are NOT shipped with secrets.** Each deployment must configure its own. See `.env.example` for variable names.

## Webhook normalization

All webhooks are normalized to:

```ts
type WebhookEvent =
  | { type:'deposit.completed',  depositId, amountMinor, currency, ts }
  | { type:'deposit.failed',     depositId, reason, ts }
  | { type:'withdrawal.completed', withdrawalId, ts }
  | { type:'withdrawal.failed',    withdrawalId, reason, ts }
  | { type:'chargeback.created',   depositId, amountMinor, reason, ts }
  | { type:'refund.completed',     depositId, amountMinor, ts };
```

Adapters are responsible for translating provider-specific events into this shape and signing the result. Idempotency is enforced at the `payments.webhook_events` table by `(adapter, external_id, type)`.

## KYC / AML

- A `kyc-service` interface (out of scope for this doc) is invoked at deposit/withdrawal based on configurable thresholds and jurisdictions.
- The `compliance` table records every screening result.
- Travel rule: cross-border wires must include originator + beneficiary.

## Reconciliation

Daily job (Kubernetes CronJob):

1. Pull yesterday's PSP records.
2. Compare with `payments.deposits` / `payments.withdrawals`.
3. Emit a `payments.reconciliation_report` event; differences are alerted.

## Adding a new adapter

1. Create `payment-service/src/adapters/<name>.ts` implementing `PaymentGateway`.
2. Register it in `payment-service/src/adapters/index.ts`.
3. Add env vars to `.env.example`.
4. Add a webhook route under `/webhooks/<name>` with signature verification.
5. Add tests + update `docs/payment.md`.

No changes to the rest of the system are required.
