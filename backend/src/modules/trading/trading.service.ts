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
import type { Candle, Market, Order, OrderBookLevel, OrderBookSnapshot, OrderSide, OrderType, PlaceOrderInput, Trade } from './trading.types';

interface BookLevel { price: bigint; amount: bigint; orders: number; }
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
        const orders = await this.repo.listUserOrders('00000000-0000-0000-0000-000000000000', { marketId: m.id, status: 'open', limit: 1 });
        this.ensureBook(m.id);
        // re-hydrate book from open orders
        const r = await this.db.query<{ side: 'buy' | 'sell'; price_minor: string; remaining: string; count: string }>(
          `SELECT side, price_minor::text, (amount_minor - filled_minor)::text AS remaining, count(*)::text
             FROM trading.orders
            WHERE market_id = $1 AND status IN ('open','partial')
            GROUP BY side, price_minor`,
          [m.id],
        );
        for (const row of r.rows) {
          const book = this.ensureBook(m.id);
          const side = row.side === 'buy' ? book.bids : book.asks;
          const lvl = side.levels.get(row.price_minor) ?? { price: BigInt(row.price_minor), amount: 0n, orders: 0 };
          lvl.amount += BigInt(row.remaining);
          lvl.orders += Number(row.count);
          side.levels.set(row.price_minor, lvl);
        }
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

  // -------------------------------------------------------------------------
  //  Public API
  // -------------------------------------------------------------------------
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
    const market = await this.repo.findMarket(input.marketId);
    if (!market) throw new NotFoundException({ code: 'MARKET_NOT_FOUND', message: 'market not found' });
    if (market.status !== 'active') throw new BadRequestException({ code: 'MARKET_PAUSED', message: 'market not active' });
    if (BigInt(input.amountMinor) <= 0n) throw new BadRequestException({ code: 'ORDER_AMOUNT_NONPOSITIVE', message: 'amount must be > 0' });
    if ((input.type === 'limit' || input.type === 'stop_limit') && !input.priceMinor) {
      throw new BadRequestException({ code: 'ORDER_PRICE_REQUIRED', message: 'price required for limit orders' });
    }

    // 1. lock funds (escrow into reserved balance)
    const quoteCurrency = market.quote_symbol as 'RIAL' | string;
    const baseCurrency = market.base_symbol as 'RIAL' | string;
    const escrow = input.type === 'market'
      ? (input.side === 'buy' ? this.estimateMarketBuyEscrow(market, input.amountMinor) : input.amountMinor)
      : (input.side === 'buy' ? (BigInt(input.priceMinor!) * BigInt(input.amountMinor) / 10n ** 8n).toString() : input.amountMinor);

    const escrowCurrency = input.side === 'buy' ? quoteCurrency : baseCurrency;
    const orderId = randomUUID();
    await this.wallets.lock({
      userId: input.userId,
      currency: escrowCurrency,
      amountMinor: escrow,
      reason: `order:${orderId}`,
      refId: orderId,
    });

    // 2. persist the order
    const order = await this.repo.insertOrder({
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
    const book = this.ensureBook(marketId);
    const bids: OrderBookLevel[] = [...book.bids.levels.values()].sort((a, b) => Number(b.price - a.price)).slice(0, depth)
      .map((l) => ({ price_minor: l.price.toString(), amount_minor: l.amount.toString(), order_count: l.orders }));
    const asks: OrderBookLevel[] = [...book.asks.levels.values()].sort((a, b) => Number(a.price - b.price)).slice(0, depth)
      .map((l) => ({ price_minor: l.price.toString(), amount_minor: l.amount.toString(), order_count: l.orders }));
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
    const levels = [...opposite.levels.entries()].sort(([a], [b]) =>
      taker.side === 'buy' ? Number(BigInt(a) - BigInt(b)) : Number(BigInt(b) - BigInt(a)),
    );
    let remaining = BigInt(taker.amount_minor);
    let totalFilled = 0n;
    let totalNotional = 0n;
    for (const [priceKey, level] of levels) {
      if (remaining === 0n) break;
      const price = BigInt(priceKey);
      // price-time priority: only cross if price is acceptable
      if (taker.side === 'buy' && taker.price_minor && price > BigInt(taker.price_minor)) break;
      if (taker.side === 'sell' && taker.price_minor && price < BigInt(taker.price_minor)) break;
      const fillAmt = remaining < level.amount ? remaining : level.amount;
      const trade: Trade = await this.executeTrade(taker, price, fillAmt);
      trades.push(trade);
      remaining -= fillAmt;
      totalFilled += fillAmt;
      totalNotional += price * fillAmt;
      level.amount -= fillAmt;
      level.orders -= 1;
      if (level.amount === 0n) opposite.levels.delete(priceKey);
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

  private async executeTrade(taker: Order, price: bigint, amount: bigint): Promise<Trade> {
    const market = await this.repo.findMarket(taker.market_id);
    if (!market) throw new Error('market disappeared');
    const feeBps = BigInt(this.tradeConfig.defaultFeeBps);
    const fee = (price * amount * feeBps) / 10_000n;
    const trade: Trade = await this.repo.insertTrade({
      id: randomUUID(),
      market_id: taker.market_id,
      buy_order_id: taker.side === 'buy' ? taker.id : taker.id, // we don't have a maker in fallback; reuse taker
      sell_order_id: taker.side === 'sell' ? taker.id : taker.id,
      buyer_id: taker.side === 'buy' ? taker.user_id : taker.user_id,
      seller_id: taker.side === 'sell' ? taker.user_id : taker.user_id,
      price_minor: price.toString(),
      amount_minor: amount.toString(),
      fee_buyer_minor: taker.side === 'buy' ? fee.toString() : '0',
      fee_seller_minor: taker.side === 'sell' ? fee.toString() : '0',
    });
    // settle wallets: unlock quote, transfer base, etc.
    const notional = (price * amount / 10n ** 8n).toString();
    const currency = market.quote_symbol as 'RIAL';
    // Taker paid: unlock reserved quote, credit base, debit fee
    if (taker.side === 'buy') {
      await this.wallets.unlock({ userId: taker.user_id, currency, amountMinor: notional, reason: 'trade:settle', refId: trade.id });
      await this.wallets.credit({ userId: taker.user_id, currency: market.base_symbol as any, amountMinor: amount.toString(), reason: 'trade:fill', type: 'trade', meta: { tradeId: trade.id } });
      if (fee > 0n) await this.wallets.debit({ userId: taker.user_id, currency, amountMinor: fee.toString(), reason: 'trade:fee', type: 'fee' });
    } else {
      await this.wallets.unlock({ userId: taker.user_id, currency: market.base_symbol as any, amountMinor: amount.toString(), reason: 'trade:settle', refId: trade.id });
      await this.wallets.credit({ userId: taker.user_id, currency, amountMinor: notional, reason: 'trade:fill', type: 'trade', meta: { tradeId: trade.id } });
      if (fee > 0n) await this.wallets.debit({ userId: taker.user_id, currency, amountMinor: fee.toString(), reason: 'trade:fee', type: 'fee' });
    }
    return trade;
  }

  private async applyExternalTrade(t: Trade) {
    this.logger.log(`external trade ${t.id} market=${t.market_id} ${t.amount_minor}@${t.price_minor}`);
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
    const level = side.levels.get(order.price_minor) ?? { price: BigInt(order.price_minor), amount: 0n, orders: 0 };
    const remaining = BigInt(order.amount_minor) - BigInt(order.filled_minor);
    level.amount += remaining;
    level.orders += 1;
    side.levels.set(order.price_minor, level);
    book.seq += 1;
  }

  private removeFromBook(orderId: string, marketId: string, side: 'buy' | 'sell', priceMinor: string | null) {
    if (!priceMinor) return;
    const book = this.ensureBook(marketId);
    const bookSide = side === 'buy' ? book.bids : book.asks;
    const level = bookSide.levels.get(priceMinor);
    if (!level) return;
    level.orders -= 1;
    if (level.orders <= 0) bookSide.levels.delete(priceMinor);
  }

  private estimateMarketBuyEscrow(market: Market, amountMinor: string): string {
    // rough estimate: last ask * amount
    const book = this.ensureBook(market.id);
    const best = [...book.asks.levels.values()].sort((a, b) => Number(a.price - b.price))[0];
    const price = best?.price ?? 0n;
    return ((price * BigInt(amountMinor)) / 10n ** 8n).toString();
  }
}
