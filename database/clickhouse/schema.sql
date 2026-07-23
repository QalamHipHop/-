-- =========================================================================
--  ClickHouse — analytics schema
-- =========================================================================
CREATE DATABASE IF NOT EXISTS rial_analytics;

CREATE TABLE IF NOT EXISTS rial_analytics.events (
  ts          DateTime64(3) CODEC(DoubleDelta, ZSTD),
  service     LowCardinality(String),
  event_type  LowCardinality(String),
  user_id     Nullable(UUID),
  trace_id    String,
  payload     String CODEC(ZSTD(3)),
  INDEX idx_event (event_type) TYPE bloom_filter(0.01) GRANULARITY 3
) ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (event_type, ts)
TTL ts + INTERVAL 365 DAY;

CREATE TABLE IF NOT EXISTS rial_analytics.ohlcv (
  market_id   UUID,
  bucket      DateTime,
  interval    LowCardinality(String),
  open_minor  Int64,
  high_minor  Int64,
  low_minor   Int64,
  close_minor Int64,
  volume_minor Int64
) ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(bucket)
ORDER BY (market_id, interval, bucket);

CREATE TABLE IF NOT EXISTS rial_analytics.orderbook_snapshots (
  ts          DateTime64(3),
  market_id   UUID,
  bids        Array(Tuple(Int64, Int64)),
  asks        Array(Tuple(Int64, Int64))
) ENGINE = MergeTree
PARTITION BY toYYYYMM(ts)
ORDER BY (market_id, ts)
TTL ts + INTERVAL 30 DAY;
