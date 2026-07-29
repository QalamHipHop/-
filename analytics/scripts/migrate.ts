/* eslint-disable no-console */
import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';
dotenv.config();

/**
 * Standalone ClickHouse migration. Run with: npm run migrate
 * Idempotent — uses CREATE TABLE IF NOT EXISTS.
 */
async function main(): Promise<void> {
  const url = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123';
  const db  = process.env.CLICKHOUSE_DB ?? 'rial_analytics';
  const user = process.env.CLICKHOUSE_USER ?? 'rial';
  const pwd  = process.env.CLICKHOUSE_PASSWORD ?? 'change-me';
  const client = createClient({ url, database: db, username: user, password: pwd });

  await client.command({ query: `CREATE DATABASE IF NOT EXISTS ${db}` });
  console.log(`✓ database ${db}`);

  const ddl: string[] = [
    `CREATE TABLE IF NOT EXISTS trades (
      tx_hash String, symbol LowCardinality(String),
      side Enum8('buy'=1,'sell'=2),
      price Decimal(38,18), amount Decimal(38,18), total_rial Decimal(38,18),
      maker String, taker String, fee Decimal(38,18),
      chain LowCardinality(String) DEFAULT 'rial',
      ts DateTime64(3)
    ) ENGINE MergeTree() PARTITION BY toYYYYMM(ts) ORDER BY (symbol, ts)`,
    `CREATE TABLE IF NOT EXISTS tokens (
      symbol String, name String, creator String,
      total_supply Decimal(38,18), model LowCardinality(String),
      graduation_threshold Decimal(38,18), state LowCardinality(String),
      reserve_balance Decimal(38,18) DEFAULT 0,
      launched_at DateTime64(3), updated_at DateTime DEFAULT now()
    ) ENGINE ReplacingMergeTree(updated_at) ORDER BY symbol`,
    `CREATE TABLE IF NOT EXISTS fees (
      source LowCardinality(String), amount Decimal(38,18),
      recipient String, ts DateTime64(3)
    ) ENGINE MergeTree() PARTITION BY toYYYYMM(ts) ORDER BY ts`,
    `CREATE TABLE IF NOT EXISTS ai_signals (
      target String, kind LowCardinality(String), score Float32,
      evidence String, ts DateTime64(3)
    ) ENGINE MergeTree() PARTITION BY toYYYYMM(ts) ORDER BY (target, ts)`,
    `CREATE TABLE IF NOT EXISTS platform_metrics (
      metric LowCardinality(String), bucket DateTime, value Float64
    ) ENGINE SummingMergeTree() PARTITION BY toYYYYMM(bucket) ORDER BY (metric, bucket)`,
  ];
  for (const q of ddl) {
    await client.command({ query: q });
    console.log('✓', q.split('\n')[0]);
  }
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
