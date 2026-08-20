/**
 *  TradingService — orchestrates placing orders, in-memory order book, fee accrual.
 *
 *  Strategy:
 *  - The MATCHING ENGINE (Rust) is the source of truth for execution. The backend
 *    publishes `trading.order.placed` and persists the order row. The matching
 *    engine emits `trading.trade.executed` events which we consume and apply
 *    fills + fees + wallet updates.
 *  - For dev / fallback we include a pure-TS in-process matcher that fills
 *    against a maintained order book (used when MATCHING_ENABLED=false).
 */
import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Redis } from 'ioredis';

import { DbService } from '../../infrastructure/database/db.service';
import { EventBusService } from '../events/event-bus.service';
import { WalletService } from '../wallet/wallet.service';
import { MatchingConfig } from '../../config/matching.config';
import { TradingConfig } from '../../config/trading.config';
import { REDIS_CLIENT } from '../../infrastructure/redis/redis.module';
import { Inject } from '@nestjs/common';

import { TradingRepository } from './trading.repository';
import type { Candle, Market, Order, OrderBookLevel, OrderBookSnapshot, PlaceOrderInput, Trade } from './trading.types';

interface BookLevel { price: bigint; amount: bigint; orders: number; queue: Order[]; }
interface BookSide { levels: Map<string, BookLevel>; }

@Injectable()
export class TradingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TradingService.name);
  private readonly books = new Map<string, { bids: BookSide; asks: BookSide; seq: number }>();
  private readonly matchConfig: MatchingConfig;
  private readonly tradeConfig: TradingConfig;

  constructor(
    private readonly db: DbService,
    private readonly repo: TradingRepository,
    private readonly events: EventBusService,
    private readonly wallets: WalletService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.matchConfig = config.get<MatchingConfig>('matching')!;
    this.tradeConfig = config.get<TradingConfig>('trading')!;
  }

  async onModuleInit() {
    // warm the in-memory book from open orders
    try {
      const markets = await this.repo.listMarkets({ status: 'active', limit: 200 });
      for (const m of markets) {
        this.ensureBook(m.id);
        const r = await this.db.query<Order>(
          `SELECT id, user_id, market_id, side, type, status, time_in_force,
                  price_minor::text, stop_price_minor::text, amount_minor::text,
                  filled_minor::text, avg_price_minor::text, fee_minor::text,
                  client_id, created_at, updated_at
             FROM trading.orders
            WHERE market_id = $1 AND status IN ('open','partial') AND price_minor IS NOT NULL
            ORDER BY created_at ASC, id ASC`,
          [m.id],
        );
        for (const order of r.rows) this.addToBook(order);
      }
    } catch (e) {
      this.logger.warn(`book warm-up failed: ${(e as Error).message}`);
    }
    // subscribe to matching engine trade events
    try {
      await this.events.subscribe?.('trading.trade.executed', (data) => this.applyExternalTrade(data as Trade));
    } catch {
      // EventBusService.subscribe is optional in current infra; safe to ignore.
    }
  }

  async onModuleDestroy() { /* nothing — Redis will close itself */ }

  private async isPlatformPaused(key: string): Promise<boolean> {
    const result = await this.db.query<{ paused: boolean }>(
      `SELECT COALESCE((value = 'true'::jsonb), false) AS paused
         FROM operations.platform_settings
        WHERE key = $1`,
      [key],
    );
    return result.rows[0]?.paused === true;
  }

  // -------------------------------------------------------------------------
  //  Public API
  // -------------------------------------------------------------------------
  async getOverviewStats() {
    const result = await this.db.query<{ volume24h: string; activeTokens: string; openOrders: string }>(`
      SELECT
        (SELECT COALESCE(SUM((price_minor::numeric * amount_minor::numeric) / 100000000), 0)::text
           FROM trading.trades WHERE created_at >= now() - interval '24 hours') AS "volume24h",
        (SELECT COUNT(*)::text FROM trading.markets WHERE status = 'active') AS "activeTokens",
        (SELECT COUNT(*)::text FROM trading.orders WHERE status IN ('open', 'partial')) AS "openOrders"
    `);
    const row = result.rows[0];
    return {
      volume24h: Number(row?.volume24h ?? 0),
      activeTokens: Number(row?.activeTokens ?? 0),
      openOrders: Number(row?.openOrders ?? 0),
      riskFlagged: null,
      changes: {},
    };
  }

  async listMarkets(opts?: { kind?: Market['kind']; chain?: string }) {
    return this.repo.listMarkets({ ...opts, status: 'active' });
  }

  async getMarket(id: string) {
    const m = await this.repo.findMarket(id);
    if (!m) throw new NotFoundException({ code: 'MARKET_NOT_FOUND', message: 'market not found' });
    return m;
  }

  async createMarket(input: { chain: string; base: string; quote?: string; kind: Market['kind']; tokenId?: string; tickMinor: string; lotMinor: string; }) {
    if (!input.base) throw new BadRequestException({ code: 'MARKET_BASE_REQUIRED', message: 'base symbol required' });
    const existing = await this.repo.findMarketBySymbols(input.chain, input.base, input.quote ?? 'RIAL');
    if (existing) return existing;
    return this.repo.createMarket({
      chain: input.chain, base_symbol: input.base, quote_symbol: input.quote ?? 'RIAL',
      kind: input.kind, token_id: input.tokenId ?? null, tick_minor: input.tickMinor, lot_minor: input.lotMinor,
      status: 'active',
    });
  }

  async placeOrder(input: PlaceOrderInput): Promise<{ order: Order; trades: Trade[]; }> {
    if (await this.isPlatformPaused('trading_paused')) {
      throw new BadRequestException({ code: 'TRADING_PAUSED', message: 'Trading is temporarily paused' });
    }
    const market = await this.repo.findMarket(input.marketId);
    if (!market) throw new NotFoundException({ code: 'MARKET_NOT_FOUND', message: 'market not found' });
    if (market.status !== 'active') throw new BadRequestException({ code: 'MARKET_PAUSED', message: 'market not active' });
    if (BigInt(input.amountMinor) <= 0n) throw new BadRequestException({ code: 'ORDER_AMOUNT_NONPOSITIVE', message: 'amount must be > 0' });
    if ((input.type === 'limit' || input.type === 'stop_limit') && !input.priceMinor) {
      throw new BadRequestException({ code: 'ORDER_PRICE_REQUIRED', message: 'price required for limit orders' });
    }

    if (input.clientId) {
      const existing = await this.repo.getOrderByClientId(input.userId, input.marketId, input.clientId);
      if (existing) return { order: existing, trades: [] };
    }

    // 1. lock funds (escrow into reserved balance)
    const quoteCurrency = market.quote_symbol as 'RIAL' | string;
    const baseCurrency = market.base_symbol as 'RIAL' | string;
    const escrow = input.type === 'market'
      ? (input.side === 'buy' ? await this.estimateMarketBuyEscrow(market, input.amountMinor) : input.amountMinor)
      : (input.side === 'buy' ? this.quoteEscrowWithFee((BigInt(input.priceMinor!) * BigInt(input.amountMinor) + 100_000_000n - 1n) / 100_000_000n) : input.amountMinor);

    const escrowCurrency = input.side === 'buy' ? quoteCurrency : baseCurrency;
    const orderId = randomUUID();
    await this.wallets.lock({
      userId: input.userId,
      currency: escrowCurrency,
      amountMinor: escrow,
      reason: `order:${orderId}`,
      refId: orderId,
    });

    // 2. persist the order; a concurrent duplicate must release its escrow.
    let order: Order;
    try {
      order = await this.repo.insertOrder({
        id: orderId,
        user_id: input.userId,
        market_id: input.marketId,
        side: input.side,
        type: input.type,
        status: 'open',
        time_in_force: input.timeInForce ?? 'GTC',
        price_minor: input.priceMinor ?? null,
        stop_price_minor: input.stopPriceMinor ?? null,
        amount_minor: input.amountMinor,
        filled_minor: '0',
        avg_price_minor: null,
        fee_minor: '0',
        client_id: input.clientId ?? null,
      });
    } catch (error) {
      const dbError = error as { code?: string };
      if (input.clientId && dbError.code === '23505') {
        await this.wallets.unlock({ userId: input.userId, currency: escrowCurrency, amountMinor: escrow, reason: `order:${orderId}:duplicate`, refId: orderId });
        const existing = await this.repo.getOrderByClientId(input.userId, input.marketId, input.clientId);
        if (existing) return { order: existing, trades: [] };
      }
      throw error;
    }

    // 3. publish to event bus (matching engine will pick it up if external)
    void this.events.publish('trading.order.placed', {
      orderId, userId: input.userId, marketId: input.marketId, side: input.side, type: input.type,
      priceMinor: input.priceMinor, amountMinor: input.amountMinor, timeInForce: input.timeInForce ?? 'GTC',
      clientId: input.clientId,
    }).catch((e) => this.logger.warn(`publish order failed: ${(e as Error).message}`));

    // 4. local in-process match (fallback / dev)
    const trades = this.matchConfig.enabled ? [] : await this.matchInProcess(order);

    return { order, trades };
  }

  async cancelOrder(userId: string, orderId: string): Promise<Order> {
    return this.db.withTransaction(async (tx) => {
      const r = await tx.query<{ order: Order; market: Market }>(
        `SELECT o.*, m.base_symbol, m.quote_symbol, m.kind AS m_kind, m.token_id, m.tick_minor::text AS m_tick,
                m.lot_minor::text AS m_lot, m.status AS m_status, m.created_at AS m_created, m.chain AS m_chain
           FROM trading.orders o
           JOIN trading.markets m ON m.id = o.market_id
          WHERE o.id = $1 FOR UPDATE`,
        [orderId],
      );
      const row = r.rows[0] as any;
      if (!row) throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'order not found' });
      if (row.user_id !== userId) throw new BadRequestException({ code: 'ORDER_NOT_OWNED', message: 'not your order' });
      if (row.status === 'filled' || row.status === 'cancelled' || row.status === 'rejected') {
        return row as Order;
      }
      const remaining = BigInt(row.amount_minor) - BigInt(row.filled_minor);
      const currency = row.side === 'buy' ? row.quote_symbol : row.base_symbol;
      await this.wallets.unlock({
        userId, currency, amountMinor: remaining.toString(),
        reason: 'order:cancel', refId: orderId,
      });
      const updated = await this.repo.updateOrder(orderId, { status: 'cancelled', filled_minor: row.filled_minor }, tx);
      this.removeFromBook(orderId, row.market_id, row.side, row.price_minor);
      void this.events.publish('trading.order.cancelled', { orderId, userId, marketId: row.market_id }).catch(() => undefined);
      return updated!;
    });
  }

  async listUserOrders(userId: string, opts: Parameters<TradingRepository['listUserOrders']>[1] = {}) {
    return this.repo.listUserOrders(userId, opts);
  }

  async listTrades(marketId: string, opts: { limit?: number } = {}) {
    return this.repo.listTrades(marketId, opts);
  }

  async getOrderBook(marketId: string, depth = 20): Promise<OrderBookSnapshot> {
    // The Rust matcher is execution authority. PostgreSQL is the durable
    // read-side snapshot for the gateway; never expose a per-process Map as
    // the public order book because replicas and restarts would diverge.
    const boundedDepth = Math.min(Math.max(Math.trunc(depth), 1), 200);
    const querySide = async (side: 'buy' | 'sell', direction: 'ASC' | 'DESC'): Promise<OrderBookLevel[]> => {
      const result = await this.db.query<OrderBookLevel>(
        `SELECT price_minor::text,
                SUM((amount_minor - filled_minor))::text AS amount_minor,
                COUNT(*)::int AS order_count
           FROM trading.orders
          WHERE market_id = $1
            AND side = $2
            AND status IN ('open', 'partial')
            AND price_minor IS NOT NULL
            AND amount_minor > filled_minor
          GROUP BY price_minor
          ORDER BY price_minor ${direction}
          LIMIT $3`,
        [marketId, side, boundedDepth],
      );
      return result.rows;
    };
    const [bids, asks] = await Promise.all([querySide('buy', 'DESC'), querySide('sell', 'ASC')]);
    return { market_id: marketId, bids, asks, ts: Date.now() };
  }

  async getCandles(marketId: string, interval: string, limit = 500): Promise<Candle[]> {
    return this.repo.getCandles(marketId, interval, limit);
  }

  // -------------------------------------------------------------------------
  //  Matching (in-process fallback)
  // -------------------------------------------------------------------------
  private async matchInProcess(taker: Order): Promise<Trade[]> {
    const trades: Trade[] = [];
    const book = this.ensureBook(taker.market_id);
    const opposite: BookSide = taker.side === 'buy' ? book.asks : book.bids;
    const levels = [...opposite.levels.entries()].sort(([a], [b]) => {
      const left = BigInt(a);
      const right = BigInt(b);
      const descending = taker.side === 'buy';
      if (left === right) return 0;
      if (descending) return left > right ? -1 : 1;
      return left < right ? -1 : 1;
    });
    let remaining = BigInt(taker.amount_minor);
    let totalFilled = 0n;
    let totalNotional = 0n;
    for (const [priceKey, level] of levels) {
      if (remaining === 0n) break;
      const price = BigInt(priceKey);
      // price-time priority: only cross if price is acceptable
      if (taker.side === 'buy' && taker.price_minor && price > BigInt(taker.price_minor)) break;
      if (taker.side === 'sell' && taker.price_minor && price < BigInt(taker.price_minor)) break;
      while (remaining > 0n && level.queue.length > 0) {
        const maker = level.queue[0];
        if (maker.user_id === taker.user_id) {
          level.queue.shift();
          level.orders = level.queue.length;
          level.amount -= BigInt(maker.amount_minor) - BigInt(maker.filled_minor);
          continue;
        }
        const makerRemaining = BigInt(maker.amount_minor) - BigInt(maker.filled_minor);
        const fillAmt = remaining < makerRemaining ? remaining : makerRemaining;
        const trade: Trade = await this.executeTrade(taker, maker, price, fillAmt);
        trades.push(trade);
        remaining -= fillAmt;
        totalFilled += fillAmt;
        totalNotional += price * fillAmt;
        maker.filled_minor = (BigInt(maker.filled_minor) + fillAmt).toString();
        level.amount -= fillAmt;
        await this.repo.updateOrder(maker.id, {
          status: BigInt(maker.filled_minor) >= BigInt(maker.amount_minor) ? 'filled' : 'partial',
          filled_minor: maker.filled_minor,
        });
        if (BigInt(maker.filled_minor) >= BigInt(maker.amount_minor)) {
          level.queue.shift();
          level.orders = level.queue.length;
        }
      }
      if (level.amount <= 0n || level.queue.length === 0) opposite.levels.delete(priceKey);
    }
    // update book with taker remainder
    if (remaining > 0n && taker.price_minor) {
      this.addToBook(taker);
      await this.repo.updateOrder(taker.id, { status: 'partial', filled_minor: (BigInt(taker.filled_minor) + totalFilled).toString() });
    } else if (remaining === 0n) {
      await this.repo.updateOrder(taker.id, {
        status: 'filled',
        filled_minor: taker.amount_minor,
        avg_price_minor: totalFilled > 0n ? (totalNotional / totalFilled).toString() : '0',
      });
    } else {
      // market order partially filled
      await this.repo.updateOrder(taker.id, {
        status: totalFilled > 0n ? 'partial' : 'rejected',
        filled_minor: totalFilled.toString(),
        avg_price_minor: totalFilled > 0n ? (totalNotional / totalFilled).toString() : null,
      });
    }
    return trades;
  }

  private async executeTrade(taker: Order, maker: Order, price: bigint, amount: bigint): Promise<Trade> {
    const market = await this.repo.findMarket(taker.market_id);
    if (!market) throw new Error('market disappeared');
    const feeBps = BigInt(this.tradeConfig.defaultFeeBps);
    const fee = (price * amount * feeBps) / 10_000n;
    const trade: Trade = await this.repo.insertTrade({
      id: randomUUID(),
      market_id: taker.market_id,
      buy_order_id: taker.side === 'buy' ? taker.id : maker.id,
      sell_order_id: taker.side === 'sell' ? taker.id : maker.id,
      buyer_id: taker.side === 'buy' ? taker.user_id : maker.user_id,
      seller_id: taker.side === 'sell' ? taker.user_id : maker.user_id,
      price_minor: price.toString(),
      amount_minor: amount.toString(),
      fee_buyer_minor: taker.side === 'buy' ? fee.toString() : '0',
      fee_seller_minor: taker.side === 'sell' ? fee.toString() : '0',
    });
    await this.settleAndMarkTrade(trade, market);
    return trade;
  }

  private async settleAndMarkTrade(trade: Trade, market: Market): Promise<void> {
    if (!(await this.repo.beginTradeSettlement(trade.id))) return;
    try {
      const txId = await this.settleWalletTrade(trade, market);
      await this.repo.markTradeSettlementSucceeded(trade.id, txId);
    } catch (error) {
      await this.repo.markTradeSettlementFailed(trade.id, (error as Error).message);
      this.logger.error(`trade settlement deferred trade=${trade.id}: ${(error as Error).message}`);
    }
  }

  /** Replays only durable pending/failed/stale-processing trades. Wallet mutations are idempotent. */
  async recoverPendingTradeSettlements(limit = 20): Promise<number> {
    const trades = await this.repo.claimTradeSettlement(limit);
    let recovered = 0;
    for (const trade of trades) {
      try {
        const market = await this.repo.findMarket(trade.market_id);
        if (!market) throw new Error(`market missing: ${trade.market_id}`);
        const txId = await this.settleWalletTrade(trade, market);
        await this.repo.markTradeSettlementSucceeded(trade.id, txId);
        recovered += 1;
      } catch (error) {
        await this.repo.markTradeSettlementFailed(trade.id, (error as Error).message);
        this.logger.error(`trade settlement retry failed trade=${trade.id}: ${(error as Error).message}`);
      }
    }
    return recovered;
  }

  private async settleWalletTrade(trade: Trade, market: Market): Promise<string> {
    // Every wallet mutation is keyed by trade id. Author: QalamHipHop.
    const amount = BigInt(trade.amount_minor);
    const price = BigInt(trade.price_minor);
    const notional = ((price * amount + 100_000_000n - 1n) / 100_000_000n).toString();
    const quote = market.quote_symbol as any;
    const base = market.base_symbol as any;
    const buyerFee = BigInt(trade.fee_buyer_minor || '0');
    const sellerFee = BigInt(trade.fee_seller_minor || '0');
    if (quote === 'RIAL') {
      await this.wallets.unlock({ userId: trade.seller_id, currency: base, amountMinor: amount.toString(), reason: 'trade:settle:unlock', refId: `${trade.id}:seller:base` });
      await this.wallets.debit({ userId: trade.seller_id, currency: base, amountMinor: amount.toString(), reason: 'trade:settle:debit', type: 'trade', clientId: `${trade.id}:seller:base`, meta: { tradeId: trade.id } });
      await this.wallets.credit({ userId: trade.buyer_id, currency: base, amountMinor: amount.toString(), reason: 'trade:fill', type: 'trade', clientId: `${trade.id}:buyer:base`, meta: { tradeId: trade.id } });
      const rialTx = await this.wallets.settleRialTrade({ buyerId: trade.buyer_id, sellerId: trade.seller_id, notional, buyerFee: buyerFee.toString(), sellerFee: sellerFee.toString(), tradeId: trade.id, meta: { marketId: market.id, priceMinor: trade.price_minor, amountMinor: trade.amount_minor } });
      return String(rialTx?.id ?? rialTx?.ID ?? rialTx?.tx_id ?? trade.id);
    }
    await this.wallets.unlock({ userId: trade.buyer_id, currency: quote, amountMinor: (BigInt(notional) + buyerFee).toString(), reason: 'trade:settle:unlock', refId: `${trade.id}:buyer:quote` });
    await this.wallets.unlock({ userId: trade.seller_id, currency: base, amountMinor: amount.toString(), reason: 'trade:settle:unlock', refId: `${trade.id}:seller:base` });
    await this.wallets.debit({ userId: trade.buyer_id, currency: quote, amountMinor: notional, reason: 'trade:settle:debit', type: 'trade', clientId: `${trade.id}:buyer:quote`, meta: { tradeId: trade.id } });
    await this.wallets.debit({ userId: trade.seller_id, currency: base, amountMinor: amount.toString(), reason: 'trade:settle:debit', type: 'trade', clientId: `${trade.id}:seller:base`, meta: { tradeId: trade.id } });
    await this.wallets.credit({ userId: trade.buyer_id, currency: base, amountMinor: amount.toString(), reason: 'trade:fill', type: 'trade', clientId: `${trade.id}:buyer:base`, meta: { tradeId: trade.id } });
    const sellerNet = BigInt(notional) - sellerFee;
    if (sellerNet <= 0n) throw new Error('TRADE_SELLER_PROCEEDS_CONSUMED_BY_FEE');
    const finalCredit = await this.wallets.credit({ userId: trade.seller_id, currency: quote, amountMinor: sellerNet.toString(), reason: 'trade:fill', type: 'trade', clientId: `${trade.id}:seller:quote`, meta: { tradeId: trade.id } });
    if (buyerFee > 0n) await this.wallets.debit({ userId: trade.buyer_id, currency: quote, amountMinor: buyerFee.toString(), reason: 'trade:fee:buyer', type: 'fee', clientId: `${trade.id}:buyer:fee`, meta: { tradeId: trade.id } });
    if (sellerFee > 0n) await this.wallets.debit({ userId: trade.seller_id, currency: quote, amountMinor: sellerFee.toString(), reason: 'trade:fee:seller', type: 'fee', clientId: `${trade.id}:seller:fee`, meta: { tradeId: trade.id } });
    return finalCredit.txId;
  }

  private async applyExternalTrade(t: Trade) {
    const existing = await this.db.query<Trade>('SELECT * FROM trading.trades WHERE id = $1', [t.id]);
    if (existing.rows[0]?.settlement_status === 'succeeded') return;
    if (existing.rows[0]) {
      const market = await this.repo.findMarket(existing.rows[0].market_id);
      if (market) await this.settleAndMarkTrade(existing.rows[0], market);
      return;
    }
    const [buyOrder, sellOrder, market] = await Promise.all([
      this.repo.getOrder(t.buy_order_id),
      this.repo.getOrder(t.sell_order_id),
      this.repo.findMarket(t.market_id),
    ]);
    if (!buyOrder || !sellOrder || !market || buyOrder.user_id !== t.buyer_id || sellOrder.user_id !== t.seller_id) {
      this.logger.error(`external trade rejected: invalid references trade=${t.id}`);
      return;
    }
    const trade = await this.repo.insertTrade(t);
    for (const order of [buyOrder, sellOrder]) {
      const filled = (BigInt(order.filled_minor) + BigInt(t.amount_minor)).toString();
      await this.repo.updateOrder(order.id, {
        filled_minor: filled,
        status: BigInt(filled) >= BigInt(order.amount_minor) ? 'filled' : 'partial',
      });
    }
    await this.settleAndMarkTrade(trade, market);
    this.logger.log(`external trade recorded ${t.id} market=${t.market_id} ${t.amount_minor}@${t.price_minor}`);
  }

  // -------------------------------------------------------------------------
  //  Book helpers
  // -------------------------------------------------------------------------
  private ensureBook(marketId: string) {
    let book = this.books.get(marketId);
    if (!book) {
      book = { bids: { levels: new Map() }, asks: { levels: new Map() }, seq: 0 };
      this.books.set(marketId, book);
    }
    return book;
  }

  private addToBook(order: Order) {
    if (!order.price_minor) return;
    const book = this.ensureBook(order.market_id);
    const side = order.side === 'buy' ? book.bids : book.asks;
    const level = side.levels.get(order.price_minor) ?? { price: BigInt(order.price_minor), amount: 0n, orders: 0, queue: [] };
    const remaining = BigInt(order.amount_minor) - BigInt(order.filled_minor);
    if (remaining <= 0n) return;
    level.amount += remaining;
    level.orders += 1;
    level.queue.push(order);
    side.levels.set(order.price_minor, level);
    book.seq += 1;
  }

  private removeFromBook(orderId: string, marketId: string, side: 'buy' | 'sell', priceMinor: string | null) {
    if (!priceMinor) return;
    const book = this.ensureBook(marketId);
    const bookSide = side === 'buy' ? book.bids : book.asks;
    const level = bookSide.levels.get(priceMinor);
    if (!level) return;
    const index = level.queue.findIndex((order) => order.id === orderId);
    if (index >= 0) {
      const order = level.queue[index];
      level.amount -= BigInt(order.amount_minor) - BigInt(order.filled_minor);
      level.queue.splice(index, 1);
      level.orders = level.queue.length;
    }
    if (level.orders <= 0) bookSide.levels.delete(priceMinor);
  }

  private quoteEscrowWithFee(notional: bigint): string {
    if (notional <= 0n) throw new BadRequestException({ code: 'ORDER_NOTIONAL_NONPOSITIVE', message: 'order notional must be positive' });
    const feeBps = BigInt(this.tradeConfig.defaultFeeBps);
    const fee = (notional * feeBps + 9_999n) / 10_000n;
    return (notional + fee).toString();
  }

  private async estimateMarketBuyEscrow(market: Market, amountMinor: string): Promise<string> {
    const requested = BigInt(amountMinor);
    if (requested <= 0n) throw new BadRequestException({ code: 'ORDER_AMOUNT_NONPOSITIVE', message: 'amount must be > 0' });
    const snapshot = await this.getOrderBook(market.id, 200);
    let remaining = requested;
    let notional = 0n;
    for (const level of snapshot.asks) {
      if (remaining <= 0n) break;
      const available = BigInt(level.amount_minor);
      const fill = remaining < available ? remaining : available;
      const levelNotional = (BigInt(level.price_minor) * fill + 99_999_999n) / 100_000_000n;
      notional += levelNotional;
      remaining -= fill;
    }
    if (remaining > 0n || notional <= 0n) {
      throw new BadRequestException({ code: 'MARKET_LIQUIDITY_UNAVAILABLE', message: 'market buy cannot be fully reserved against current ask depth' });
    }
    return this.quoteEscrowWithFee(notional);
  }
}
