import { Injectable, OnModuleInit } from '@nestjs/common';
import { ClickHouseService } from '../clickhouse/clickhouse.service';
import { RedisService } from '../redis/redis.service';
import { KafkaService } from '../kafka/kafka.service';
import { loadConfig } from '../config/config';
import { logger } from '../common/logger';
import { TradeEvent, LaunchEvent, FeeEvent, AISignalEvent } from './metrics.types';

/**
 * High-throughput ingestion: every event goes to BOTH ClickHouse (durable,
 * queryable) and Redis (real-time counters, leaderboards, rate limits).
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly cfg = loadConfig();

  constructor(
    private readonly ch: ClickHouseService,
    private readonly redis: RedisService,
    private readonly kafka: KafkaService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSchema();
    await this.startConsumers();
  }

  // -----------------------------------------------------------------
  //  Public read API used by the GraphQL layer
  // -----------------------------------------------------------------

  async topMovers(limit = 10, windowMin = 5): Promise<{ symbol: string; changePct: number }[]> {
    const rows = await this.ch.query<{ symbol: string; change_pct: number }>(
      `SELECT
         symbol,
         (argMax(price, ts) - argMin(price, ts)) / nullIf(argMin(price, ts), 0) * 100 AS change_pct
       FROM trades
       WHERE ts >= now() - INTERVAL {minutes:UInt32} MINUTE
       GROUP BY symbol
       ORDER BY change_pct DESC
       LIMIT {limit:UInt32}`,
      { minutes: windowMin, limit },
    );
    return rows.map((r) => ({ symbol: r.symbol, changePct: Number(r.change_pct) }));
  }

  async trending(limit = 20): Promise<{ symbol: string; score: number }[]> {
    const members = await this.redis.zrevrange('trending:5m', 0, limit - 1);
    return members.map((m) => ({ symbol: m, score: 0 }));
  }

  async platformStats(): Promise<{
    tvlRial: string;
    volume24h: string;
    trades24h: number;
    tokens: number;
  }> {
    const [tvl] = await this.ch.query<{ s: string }>(
      `SELECT toString(sum(reserve_balance)) AS s FROM tokens FINAL WHERE state = 'GRADUATED'`,
    );
    const [vol] = await this.ch.query<{ s: string; c: number }>(
      `SELECT toString(sum(total_rial)) AS s, count() AS c
       FROM trades WHERE ts >= now() - INTERVAL 24 HOUR`,
    );
    const [cnt] = await this.ch.query<{ c: number }>(`SELECT count() AS c FROM tokens FINAL`);
    return {
      tvlRial: tvl?.s ?? '0',
      volume24h: vol?.s ?? '0',
      trades24h: Number(vol?.c ?? 0),
      tokens: Number(cnt?.c ?? 0),
    };
  }

  // -----------------------------------------------------------------
  //  Kafka consumers
  // -----------------------------------------------------------------

  private async startConsumers(): Promise<void> {
    const topics = this.cfg.kafka.topics;
    await Promise.all([
      this.kafka.subscribe(topics.trades, 'trades', async ({ message }) => this.handleTrade(JSON.parse(message.value!.toString()))),
      this.kafka.subscribe(topics.launches, 'launches', async ({ message }) => this.handleLaunch(JSON.parse(message.value!.toString()))),
      this.kafka.subscribe(topics.fees, 'fees', async ({ message }) => this.handleFee(JSON.parse(message.value!.toString()))),
      this.kafka.subscribe(topics.aiSignals, 'ai', async ({ message }) => this.handleAI(JSON.parse(message.value!.toString()))),
    ]);
  }

  private async handleTrade(e: TradeEvent): Promise<void> {
    await this.ch.insert('trades', [{
      tx_hash: e.txHash,
      symbol: e.symbol,
      side: e.side,
      price: e.price,
      amount: e.amount,
      total_rial: e.totalRial,
      maker: e.maker,
      taker: e.taker,
      fee: e.fee,
      chain: e.chain ?? 'rial',
      ts: new Date(e.ts),
    }]);
    // Real-time trending: increment per-token trade count in 5m window.
    await this.redis.zincrby('trending:5m', 1, e.symbol);
    await this.redis.expire('trending:5m', 300);
  }

  private async handleLaunch(e: LaunchEvent): Promise<void> {
    await this.ch.insert('tokens', [{
      symbol: e.symbol,
      name: e.name,
      creator: e.creator,
      total_supply: e.totalSupply,
      model: e.model,
      graduation_threshold: e.graduationThreshold,
      state: 'LIVE',
      reserve_balance: '0',
      launched_at: new Date(e.ts),
    }]);
  }

  private async handleFee(e: FeeEvent): Promise<void> {
    await this.ch.insert('fees', [{
      source: e.source,
      amount: e.amount,
      recipient: e.recipient,
      ts: new Date(e.ts),
    }]);
  }

  private async handleAI(e: AISignalEvent): Promise<void> {
    await this.ch.insert('ai_signals', [{
      target: e.target,
      kind: e.kind,
      score: e.score,
      evidence: JSON.stringify(e.evidence ?? {}),
      ts: new Date(e.ts),
    }]);
  }

  // -----------------------------------------------------------------
  //  Schema bootstrap
  // -----------------------------------------------------------------

  private async ensureSchema(): Promise<void> {
    const ddl = [
      `CREATE TABLE IF NOT EXISTS trades (
        tx_hash      String,
        symbol       LowCardinality(String),
        side         Enum8('buy'=1, 'sell'=2),
        price        Decimal(38, 18),
        amount       Decimal(38, 18),
        total_rial   Decimal(38, 18),
        maker        String,
        taker        String,
        fee          Decimal(38, 18),
        chain        LowCardinality(String) DEFAULT 'rial',
        ts           DateTime64(3)
      ) ENGINE = MergeTree() PARTITION BY toYYYYMM(ts) ORDER BY (symbol, ts)`,
      `CREATE TABLE IF NOT EXISTS tokens (
        symbol              String,
        name                String,
        creator             String,
        total_supply        Decimal(38, 18),
        model               LowCardinality(String),
        graduation_threshold Decimal(38, 18),
        state               LowCardinality(String),
        reserve_balance     Decimal(38, 18) DEFAULT 0,
        launched_at         DateTime64(3),
        updated_at          DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree(updated_at) ORDER BY symbol`,
      `CREATE TABLE IF NOT EXISTS fees (
        source    LowCardinality(String),
        amount    Decimal(38, 18),
        recipient String,
        ts        DateTime64(3)
      ) ENGINE = MergeTree() PARTITION BY toYYYYMM(ts) ORDER BY ts`,
      `CREATE TABLE IF NOT EXISTS ai_signals (
        target  String,
        kind    LowCardinality(String),
        score   Float32,
        evidence String,
        ts      DateTime64(3)
      ) ENGINE = MergeTree() PARTITION BY toYYYYMM(ts) ORDER BY (target, ts)`,
      `CREATE TABLE IF NOT EXISTS platform_metrics (
        metric LowCardinality(String),
        bucket DateTime,
        value  Float64
      ) ENGINE = SummingMergeTree() PARTITION BY toYYYYMM(bucket) ORDER BY (metric, bucket)`,
    ];
    for (const stmt of ddl) {
      try {
        await this.ch.exec(stmt);
      } catch (e) {
        logger.warn({ err: (e as Error).message, stmt: stmt.split('\n')[0] }, 'ddl failed (may already exist)');
      }
    }
    logger.info('clickhouse schema ensured');
  }
}
