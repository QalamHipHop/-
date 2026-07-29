# Matching Engine

Low-latency, in-memory matching engine for the Rial platform — written in Rust.

## Capabilities

- **Order types**: Market, Limit, Iceberg, Stop, Stop-Limit, Trailing-Stop
- **Time-in-force**: GTC, IOC, FOK, GTD, DAY
- **Matching**: Strict price-time priority (FIFO within a price level)
- **Markets**: One isolated order book per market, multi-market via `dashmap`
- **Concurrency**: Per-market `parking_lot::Mutex` — global throughput scales with # markets
- **Fees**: Configurable taker (bps) and maker (bps, supports negative for rebates)
- **Settlement**: Emits `Trade` events with buyer/seller, taker side, fees, sequence
- **APIs**:
  - gRPC (`50051`) — submit, cancel, cancel-all, get, book, stream
  - HTTP health (`8081`) — `/healthz`, `/readyz`
  - Prometheus metrics (`9101`)

## Build

```bash
cargo build --release
```

## Test

```bash
cargo test
```

## Run

```bash
MATCHING_GRPC_ADDR=0.0.0.0:50051 \
MATCHING_HEALTH_ADDR=0.0.0.0:8081 \
MATCHING_METRICS_ADDR=0.0.0.0:9101 \
RUST_LOG=info \
./target/release/matching-engine
```

## Docker

```bash
docker build -t rial/matching-engine .
docker run --rm -p 50051:50051 -p 8081:8081 -p 9101:9101 rial/matching-engine
```

## Proto

`proto/matching.proto` — package `rial.matching.v1`. Generated via `tonic-build`
in `build.rs`.

## Architecture

```
┌─────────────┐    gRPC     ┌──────────────────────┐
│  Backend    │ ──────────▶ │  Matching Engine     │
│  (NestJS)   │             │  ┌────────────────┐  │
└─────────────┘             │  │ Engine         │  │
                            │  │  └ markets[]   │  │
                            │  │     └ Mutex<   │  │
                            │  │       Market   │  │
                            │  │       └ Book   │  │
                            │  └────────────────┘  │
                            └──────────────────────┘
```

The engine is single-threaded *per market* (lock-held mutation). Concurrent
submissions to different markets are fully parallel.
