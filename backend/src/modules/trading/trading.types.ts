/**
 *  Trading shared types.
 */
export type OrderSide = 'buy' | 'sell';
export type OrderType = 'market' | 'limit' | 'stop' | 'stop_limit' | 'iceberg' | 'trailing' | 'oco';
export type OrderStatus = 'open' | 'partial' | 'filled' | 'cancelled' | 'rejected' | 'expired';
export type OrderTIF = 'GTC' | 'IOC' | 'FOK' | 'GTD';
export type MarketKind = 'spot' | 'perp' | 'launch';

export interface Market {
  id: string;
  chain: string;
  base_symbol: string;
  quote_symbol: string;
  kind: MarketKind;
  token_id: string | null;
  tick_minor: string;
  lot_minor: string;
  status: 'active' | 'paused' | 'delisted';
  created_at: Date;
}

export interface Order {
  id: string;
  user_id: string;
  market_id: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  time_in_force: OrderTIF;
  price_minor: string | null;
  stop_price_minor: string | null;
  amount_minor: string;
  filled_minor: string;
  avg_price_minor: string | null;
  fee_minor: string;
  client_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface Trade {
  id: string;
  market_id: string;
  buy_order_id: string;
  sell_order_id: string;
  buyer_id: string;
  seller_id: string;
  price_minor: string;
  amount_minor: string;
  fee_buyer_minor: string;
  fee_seller_minor: string;
  settlement_status?: 'pending' | 'processing' | 'succeeded' | 'failed';
  settlement_attempts?: number;
  settlement_next_attempt_at?: Date;
  settlement_last_error?: string | null;
  settlement_tx_id?: string | null;
  settled_at?: Date | null;
  settlement_claim_token?: string | null;
  created_at: Date;
}

export interface PlaceOrderInput {
  userId: string;
  marketId: string;
  side: OrderSide;
  type: OrderType;
  timeInForce?: OrderTIF;
  priceMinor?: string;
  stopPriceMinor?: string;
  amountMinor: string;
  clientId?: string;
  icebergVisibleMinor?: string;
  reduceOnly?: boolean;
  postOnly?: boolean;
  expiresAt?: Date;
}

export interface OrderBookLevel { price_minor: string; amount_minor: string; order_count: number; }
export interface OrderBookSnapshot { market_id: string; bids: OrderBookLevel[]; asks: OrderBookLevel[]; ts: number; }
export interface Candle { bucket: Date; open: number; high: number; low: number; close: number; volume: number; }
