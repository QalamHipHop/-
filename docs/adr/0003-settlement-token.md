# ADR-0003: `﷼` as Internal Settlement Unit, Configurable FX

- Status: Accepted

## Context
We want users to think in a single unit, but we cannot assume a permanent peg to any fiat or crypto.

## Decision
- All in-platform balances, fees, prices, rewards are denominated in `﷼` (symbol and name are the same: `﷼`).
- `﷼` is **not** a token on any chain by default. It is a unit of account.
- A `RateProvider` resolves `﷼` ↔ external currency at deposit, withdrawal, and display time.
- Strategy: `fixed` | `floating` | `external` (selectable via `EXCHANGE_RATE_STRATEGY`).
- Storage: every amount is `BIGINT` minor units (8 decimal places). Floats are forbidden.

## Consequences
- Disambiguates "internal credit" from "withdrawable value."
- Lets us support a stablecoin peg in one region and a free-floating model in another.
- We must be explicit at every UI boundary about whether a displayed `﷼` is internal or converted.
