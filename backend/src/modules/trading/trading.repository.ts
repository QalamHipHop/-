/**
 *  TradingRepository — DB layer for markets, orders, trades, candles.
 *  All public methods are read/write; no business rules here.
 */
import { Injectable } from '@nestjs/common';
import type { PoolClient, QueryResultRow } from 'pg';

type Queryable = { query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: ReadonlyArray<unknown>): Promise<{ rows: T[] }> };
import { DbService } from '../../infrastructure/database/db.service';
import type { Market, MarketKind, Order, OrderSide, OrderStatus, OrderType, Trade } from './trading.types';

@Injectable()
export class TradingRepository {
  constructor(private readonly db: DbService) {}
  private c(c?: PoolClient): Queryable { return (c ?? this.db) as Queryable; }

  // ---- markets ----
  async findMarket(id: string, c?: PoolClient): Promise<Market | null> {
    const r = await this.c(c).query<Market>('SELECT * FROM trading.markets WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  }

  async findMarketBySymbols(chain: string, base: string, quote: string, c?: PoolClient): Promise<Market | null> {
    const r = await this.c(c).query<Market>(
      `SELECT * FROM trading.markets WHERE chain = $1 AND base_symbol = $2 AND quote_symbol = $3 LIMIT 1`,
      [chain, base, quote],
    );
    return r.rows[0] ?? null;
  }

  async listMarkets(opts: { kind?: MarketKind; chain?: string; status?: Market['status']; limit?: number; offset?: number } = {}): Promise<Market[]> {
    const params: unknown[] = [];
    const where: string[] = ['1=1'];
    if (opts.kind) { params.push(opts.kind); where.push(`kind = $${params.length}`); }
    if (opts.chain) { params.push(opts.chain); where.push(`chain = $${params.length}`); }
    if (opts.status) { params.push(opts.status); where.push(`status = $${params.length}`); }
    params.push(opts.limit ?? 100); params.push(opts.offset ?? 0);
    const r = await this.c().query<Market>(
      `SELECT * FROM trading.markets WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return r.rows;
  }

  async createMarket(input: Omit<Market, 'id' | 'created_at'> & { id?: string }, c?: PoolClient): Promise<Market> {
    const r = await this.c(c).query<Market>(
      `INSERT INTO trading.markets (id, chain, base_symbol, quote_symbol, kind, token_id, tick_minor, lot_minor, status)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7::bigint, $8::bigint, $9) RETURNING *`,
      [input.id ?? null, input.chain, input.base_symbol, input.quote_symbol, input.kind, input.token_id, input.tick_minor, input.lot_minor, input.status],
    );
    return r.rows[0];
  }

  // ---- orders ----
  async insertOrder(input: Omit<Order, 'created_at' | 'updated_at'>, c?: PoolClient): Promise<Order> {
    const r = await this.c(c).query<Order>(
      `INSERT INTO trading.orders
        (id, user_id, market_id, side, type, status, time_in_force, price_minor, stop_price_minor,
         amount_minor, filled_minor, avg_price_minor, fee_minor, client_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::bigint, $9::bigint, $10::bigint, $11::bigint, $12::bigint, $13::bigint, $14) RETURNING *`,
      [input.id, input.user_id, input.market_id, input.side, input.type, input.status, input.time_in_force,
       input.price_minor, input.stop_price_minor, input.amount_minor, input.filled_minor, input.avg_price_minor, input.fee_minor, input.client_id],
    );
    return r.rows[0];
  }

  async getOrder(id: string, c?: PoolClient): Promise<Order | null> {
    const r = await this.c(c).query<Order>('SELECT * FROM trading.orders WHERE id = $1', [id]);
    return r.rows[0] ?? null;
  }

  async updateOrder(id: string, patch: Partial<Pick<Order, 'status' | 'filled_minor' | 'avg_price_minor' | 'fee_minor'>>, c?: PoolClient): Promise<Order | null> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (patch.status) { params.push(patch.status); fields.push(`status = $${params.length}`); }
    if (patch.filled_minor !== undefined) { params.push(patch.filled_minor); fields.push(`filled_minor = $${params.length}::bigint`); }
    if (patch.avg_price_minor !== undefined) { params.push(patch.avg_price_minor); fields.push(`avg_price_minor = $${params.length}::bigint`); }
    if (patch.fee_minor !== undefined) { params.push(patch.fee_minor); fields.push(`fee_minor = $${params.length}::bigint`); }
    if (!fields.length) return this.getOrder(id, c);
    fields.push(`updated_at = now()`);
    params.push(id);
    const r = await this.c(c).query<Order>(`UPDATE trading.orders SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
    return r.rows[0] ?? null;
  }

  async getOrderByClientId(userId: string, marketId: string, clientId: string, c?: PoolClient): Promise<Order | null> {
    const r = await this.c(c).query<Order>(
      'SELECT * FROM trading.orders WHERE user_id = $1 AND market_id = $2 AND client_id = $3 LIMIT 1',
      [userId, marketId, clientId],
    );
    return r.rows[0] ?? null;
  }

  async listUserOrders(userId: string, opts: { marketId?: string; status?: OrderStatus; side?: OrderSide; type?: OrderType; limit?: number; offset?: number } = {}): Promise<Order[]> {
    const params: unknown[] = [userId];
    const where: string[] = ['user_id = $1'];
    if (opts.marketId) { params.push(opts.marketId); where.push(`market_id = $${params.length}`); }
    if (opts.status) { params.push(opts.status); where.push(`status = $${params.length}`); }
    if (opts.side) { params.push(opts.side); where.push(`side = $${params.length}`); }
    if (opts.type) { params.push(opts.type); where.push(`type = $${params.length}`); }
    params.push(opts.limit ?? 50); params.push(opts.offset ?? 0);
    const r = await this.c().query<Order>(
      `SELECT * FROM trading.orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return r.rows;
  }

  // ---- trades ----
  async insertTrade(input: Omit<Trade, 'created_at'>, c?: PoolClient): Promise<Trade> {
    const r = await this.c(c).query<Trade>(
      `INSERT INTO trading.trades
        (id, market_id, buy_order_id, sell_order_id, buyer_id, seller_id, price_minor, amount_minor, fee_buyer_minor, fee_seller_minor,
         settlement_status, settlement_next_attempt_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::bigint, $8::bigint, $9::bigint, $10::bigint, 'pending', now()) RETURNING *`,
      [input.id, input.market_id, input.buy_order_id, input.sell_order_id, input.buyer_id, input.seller_id,
       input.price_minor, input.amount_minor, input.fee_buyer_minor, input.fee_seller_minor],
    );
    return r.rows[0];
  }

  async claimTradeSettlement(limit = 20): Promise<Trade[]> {
    return this.db.withTransaction(async (tx) => {
      const r = await tx.query<Trade>(
        `WITH candidates AS (
           SELECT id FROM trading.trades
           WHERE ((settlement_status IN ('pending','failed') AND settlement_next_attempt_at <= now())
              OR (settlement_status = 'processing' AND settlement_processing_started_at < now() - interval '5 minutes'))
           ORDER BY created_at ASC
           FOR UPDATE SKIP LOCKED LIMIT $1
         )
         UPDATE trading.trades t
         SET settlement_status = 'processing', settlement_attempts = t.settlement_attempts + 1,
             settlement_processing_started_at = now(), settlement_claim_token = gen_random_uuid()::text
         FROM candidates c WHERE t.id = c.id RETURNING t.*`,
        [limit],
      );
      return r.rows;
    });
  }

  async beginTradeSettlement(tradeId: string): Promise<string | null> {
    const r = await this.db.query<{ settlement_claim_token: string }>(
      `UPDATE trading.trades SET settlement_status = 'processing', settlement_attempts = settlement_attempts + 1,
          settlement_processing_started_at = now(), settlement_claim_token = gen_random_uuid()::text
       WHERE id = $1 AND settlement_status IN ('pending','failed') RETURNING settlement_claim_token`,
      [tradeId],
    );
    return r.rows[0]?.settlement_claim_token ?? null;
  }

  async markTradeSettlementSucceeded(tradeId: string, txId: string, claimToken: string): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE trading.trades SET settlement_status = 'succeeded', settlement_tx_id = $2, settled_at = now(), settlement_processing_started_at = NULL, settlement_claim_token = NULL, settlement_last_error = NULL
       WHERE id = $1 AND settlement_status = 'processing' AND settlement_claim_token = $3`,
      [tradeId, txId, claimToken],
    );
    return r.rowCount === 1;
  }

  async markTradeSettlementFailed(tradeId: string, error: string, claimToken: string, maxBackoffSeconds = 300): Promise<boolean> {
    const r = await this.db.query(
      `UPDATE trading.trades
       SET settlement_status = 'failed', settlement_processing_started_at = NULL, settlement_claim_token = NULL, settlement_last_error = left($2, 2000),
           settlement_next_attempt_at = now() + LEAST(make_interval(secs => GREATEST(5, power(2::numeric, LEAST(settlement_attempts, 8))::int)), make_interval(secs => $4))
       WHERE id = $1 AND settlement_status = 'processing' AND settlement_claim_token = $3`,
      [tradeId, error, claimToken, maxBackoffSeconds],
    );
    return r.rowCount === 1;
  }

  async listTrades(marketId: string, opts: { limit?: number; since?: Date } = {}): Promise<Trade[]> {
    const params: unknown[] = [marketId];
    let where = 'market_id = $1';
    if (opts.since) { params.push(opts.since); where += ` AND created_at > $${params.length}`; }
    params.push(opts.limit ?? 100);
    const r = await this.c().query<Trade>(
      `SELECT * FROM trading.trades WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    return r.rows;
  }

  // ---- candles ----
  async upsertCandle(input: { marketId: string; interval: string; bucket: Date; open: string; high: string; low: string; close: string; volumeMinor: string }, c?: PoolClient): Promise<void> {
    await this.c(c).query(
      `INSERT INTO trading.candles (market_id, interval, bucket, open_minor, high_minor, low_minor, close_minor, volume_minor)
       VALUES ($1, $2, $3, $4::bigint, $5::bigint, $6::bigint, $7::bigint, $8::bigint)
       ON CONFLICT (market_id, interval, bucket) DO UPDATE
         SET high_minor  = GREATEST(trading.candles.high_minor, EXCLUDED.high_minor),
             low_minor   = LEAST(trading.candles.low_minor, EXCLUDED.low_minor),
             close_minor = EXCLUDED.close_minor,
             volume_minor = trading.candles.volume_minor + EXCLUDED.volume_minor`,
      [input.marketId, input.interval, input.bucket, input.open, input.high, input.low, input.close, input.volumeMinor],
    );
  }

  async getCandles(marketId: string, interval: string, limit = 500): Promise<Array<{ bucket: Date; open: string; high: string; low: string; close: string; volume: string }>> {
    const r = await this.c().query<{ bucket: Date; open_minor: string; high_minor: string; low_minor: string; close_minor: string; volume_minor: string }>(
      `SELECT bucket, open_minor::text, high_minor::text, low_minor::text, close_minor::text, volume_minor::text
         FROM trading.candles
        WHERE market_id = $1 AND interval = $2
        ORDER BY bucket DESC LIMIT $3`,
      [marketId, interval, limit],
    );
    return r.rows.map((row) => ({
      bucket: row.bucket,
      open: row.open_minor,
      high: row.high_minor,
      low: row.low_minor,
      close: row.close_minor,
      volume: row.volume_minor,
    })).reverse();
  }
}
