# ADR-0002: Pluggable Payment Adapters

- Status: Accepted

## Context
We don't want to bind the platform to a single PSP, bank, or crypto on-ramp. Regulations and partners differ by jurisdiction.

## Decision
Define `PaymentGateway` interface in `payment-service`. Each provider (Stripe, a Persian shetab processor, a crypto on-ramp, a manual bank-transfer reconciliation) is an adapter implementing that interface. Adapter selection is per-tenant configurable at runtime. Webhooks are normalized to a common event schema.

## Consequences
- Adding a provider does not require code changes outside the new adapter.
- All adapters must support idempotency and signed webhooks.
- Refunds, chargebacks, and KYC/AML signals are normalized.
