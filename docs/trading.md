# Trading & Matching Engine

Two services cooperate:

- **`matching-engine`** (Rust) — the authoritative order book and matcher. Stateless client of the WAL.
- **`trading-engine`** (Rust) — order intake, smart routing, risk checks, market making hooks, settlement.

## Order types

| Type        | Description                                                  |
|-------------|--------------------------------------------------------------|
| `market`    | Match against the book at the best available price.          |
| `limit`     | Rest on the book until filled, cancelled, or expired.        |
| `stop`      | Becomes market when `last >= stop_price` (or <= for sells).  |
| `stop_limit`| Becomes limit when stop triggers.                            |
| `iceberg`   | Only `display_size` is visible; refreshes on fill.           |
| `trailing`  | Stop that follows the market by a fixed offset.              |
| `oco`       | One-cancels-the-other pair (typically stop + limit).         |

Time-in-force: `GTC` (default), `IOC`, `FOK`, `GTD` (with `expire_at`).

## Matching algorithm

- Per-market in-memory order book (bids/asks as price-level linked lists).
- Price-time priority. Partial fills supported.
- Each fill emits a `trades` row and updates balances via the wallet service.
- A single writer per market (per partition); partition by `market_id` to scale horizontally.
- Idempotent submission via client-supplied `client_id` (UUID per order).
- All state changes are journaled to a write-ahead log and snapshotted every N events.

## Smart routing (trading-engine)

When a market order spans multiple venues (in-app book + on-chain AMM):
1. Compute the executable price on each venue.
2. Split the order to minimize slippage and gas.
3. Submit, then aggregate fills.

## Fees

Configurable per-market, per-kind, in basis points:
- `platform`, `creator`, `referral`, `affiliate`, `burn`, `treasury`.
- Dynamic: a hook can adjust fees based on volatility, time of day, or user tier.

## Risk

- Per-user order-rate limit, position limit, max notional.
- Per-asset drawdown limit; emergency pause per market.
- Self-trade prevention (cancel-maker / cancel-taker).

## Settlement

After a fill:
1. Trade row written to `trading.trades`.
2. Buyer: `-rial_in_minor - fee_buyer_minor`, `+base_minor`.
3. Seller: `+rial_in_minor - fee_seller_minor`, `-base_minor`.
4. Fee splits: per-kind `fees.accruals` row + corresponding wallet credit.
5. All in a single Postgres transaction; on success, outbox event.

## Market data

- L2 snapshots → WebSocket topic `book:<market_id>`.
- Trades → `trades:<market_id>`.
- OHLCV candles (1m/5m/15m/1h/4h/1d) → ClickHouse.
- All consumers authenticate via JWT; subscriptions are rate-limited per connection.
