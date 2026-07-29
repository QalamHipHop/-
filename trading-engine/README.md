# trading-engine

Order routing and market-making service for the **Rial** platform.

## Responsibilities

- **Smart order routing** — picks a venue (internal matching engine by
  default) and, for marketable orders, applies configurable
  slippage-aware pricing.
- **Market making** — runs per-symbol strategies that emit
  bid/ask quotes pegged to a reference price, with inventory skew.
- **Strategy execution** — TWAP / VWAP / inventory-skew strategies
  live here.
- **Health & metrics** — `GET /healthz` (JSON) and `GET /metrics`
  (Prometheus) on the dedicated health port.

## Layout

```
trading-engine/
├── Cargo.toml
├── build.rs                 # tonic-build
├── proto/trading.proto      # gRPC contract
├── config/trading.example.yaml
└── src/
    ├── main.rs              # entry point
    ├── lib.rs
    ├── config.rs            # YAML + env layering
    ├── decimal.rs           # bps / notional helpers
    ├── health.rs            # hyper /healthz, /metrics
    ├── metrics.rs           # prometheus exporter
    ├── proto.rs             # generated bindings
    ├── router.rs            # order routing logic
    ├── service.rs           # gRPC service impl
    ├── strategy.rs          # strategy engine
    └── types.rs             # core domain types
```

## Run

```bash
# defaults
cargo run --release

# or with custom config
TRADING_CONFIG=/path/to/trading.yaml cargo run --release
```

## gRPC

`TradingEngine` service in `proto/trading.proto` — see
`docs/api/grpc.md` for usage examples.

## Tests

```bash
cargo test
```
