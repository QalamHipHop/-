//! Matching engine — price-time priority, supports Market/Limit/IOC/FOK/Stop.
//!
//! Single-threaded per market. Books are mutated under a parking_lot::Mutex
//! held by the per-market Engine struct.

use crate::decimal::{is_positive, min, zero};
use crate::orderbook::OrderBook;
use crate::types::{Order, OrderStatus, OrderType, Side, TimeInForce, Trade};
use rust_decimal::Decimal;
use std::sync::Arc;
use parking_lot::Mutex;

#[derive(Debug, Clone, Copy)]
pub struct FeeSchedule {
    /// Taker fee in basis points (1 bp = 0.01%).
    pub taker_bps: u32,
    /// Maker fee in basis points (negative = maker rebate).
    pub maker_bps: i32,
}

impl Default for FeeSchedule {
    fn default() -> Self {
        Self { taker_bps: 30, maker_bps: 10 }
    }
}

pub struct Market {
    pub name: String,
    pub book: OrderBook,
    pub fees: FeeSchedule,
}

impl Market {
    pub fn new(name: impl Into<String>, fees: FeeSchedule) -> Self {
        Self {
            name: name.into(),
            book: OrderBook::new(name.into()),
            fees,
        }
    }
}

pub struct Engine {
    pub markets: dashmap::DashMap<String, Arc<Mutex<Market>>>,
    default_fees: FeeSchedule,
}

impl Engine {
    pub fn new(default_fees: FeeSchedule) -> Self {
        Self {
            markets: dashmap::DashMap::new(),
            default_fees,
        }
    }

    pub fn market(&self, name: &str) -> Option<Arc<Mutex<Market>>> {
        self.markets.get(name).map(|m| m.clone())
    }

    pub fn get_or_create(&self, name: &str) -> Arc<Mutex<Market>> {
        if let Some(m) = self.markets.get(name) {
            return m.clone();
        }
        let m = Arc::new(Mutex::new(Market::new(name, self.default_fees)));
        self.markets.insert(name.to_string(), m.clone());
        m
    }

    /// Submit an order and run matching. Returns the updated order + any trades.
    pub fn submit(&self, mut order: Order) -> SubmitResult {
        let market = self.get_or_create(&order.market);
        let mut m = market.lock();
        let book = &mut m.book;

        order.sequence = book.next_seq();
        let mut trades: Vec<Trade> = Vec::new();
        let initial_remaining = order.remaining_quantity;

        match order.tif {
            TimeInForce::Fok => {
                // FOK: either fill entirely or reject.
                let fillable = self.peek_fillable(book, &order);
                if fillable < initial_remaining {
                    order.status = OrderStatus::Rejected;
                    SubmitResult { order, trades, fully_filled: false }
                } else {
                    self.cross(book, &mut order, &mut trades, m.fees);
                    SubmitResult {
                        order,
                        trades,
                        fully_filled: order.remaining_quantity.is_zero(),
                    }
                }
            }
            TimeInForce::Ioc => {
                self.cross(book, &mut order, &mut trades, m.fees);
                if !order.remaining_quantity.is_zero() {
                    order.status = if order.filled_quantity.is_zero() {
                        OrderStatus::Canceled
                    } else {
                        OrderStatus::PartiallyFilled
                    };
                }
                SubmitResult {
                    order,
                    trades,
                    fully_filled: order.remaining_quantity.is_zero(),
                }
            }
            TimeInForce::Gtc | TimeInForce::Gtd | TimeInForce::Day => {
                self.cross(book, &mut order, &mut trades, m.fees);
                let resting = !order.remaining_quantity.is_zero()
                    && matches!(order.order_type, OrderType::Limit);
                if resting {
                    book.insert_resting(order.clone());
                }
                SubmitResult {
                    order,
                    trades,
                    fully_filled: order.remaining_quantity.is_zero(),
                }
            }
        }
    }

    pub fn cancel(&self, market: &str, order_id: &str) -> Option<Order> {
        let m = self.market(market)?;
        let mut m = m.lock();
        m.book.remove(market, order_id)
    }

    pub fn cancel_all(&self, user_id: &str, market_filter: Option<&str>) -> Vec<Order> {
        let mut all = Vec::new();
        for entry in self.markets.iter() {
            let mut m = entry.value().lock();
            all.extend(m.book.remove_user(user_id, market_filter));
        }
        all
    }

    // ---------- Internals ----------

    fn peek_fillable(&self, book: &OrderBook, order: &Order) -> Decimal {
        let mut fillable = zero();
        let opp_book = match order.side {
            Side::Buy => &book.asks,
            Side::Sell => &book.bids,
        };
        for (price, queue) in opp_book.iter() {
            if !self.price_crosses(order, *price) {
                break;
            }
            for o in queue.iter() {
                fillable += o.remaining_quantity;
                if fillable >= order.remaining_quantity {
                    return order.remaining_quantity;
                }
            }
        }
        fillable
    }

    fn price_crosses(&self, order: &Order, opp_price: Decimal) -> bool {
        match (order.side, order.price) {
            (Side::Buy, Some(p)) => p >= opp_price,
            (Side::Sell, Some(p)) => p <= opp_price,
            (_, None) => true, // market
        }
    }

    fn cross(
        &self,
        book: &mut OrderBook,
        taker: &mut Order,
        trades: &mut Vec<Trade>,
        fees: FeeSchedule,
    ) {
        let opp_book = match taker.side {
            Side::Buy => &mut book.asks,
            Side::Sell => &mut book.bids,
        };
        let mut empty_prices: Vec<Decimal> = Vec::new();

        for (price, queue) in opp_book.iter_mut() {
            if !self.price_crosses(taker, *price) {
                break;
            }
            while taker.remaining_quantity > zero() && !queue.is_empty() {
                let maker = queue.front_mut().unwrap();
                if maker.remaining_quantity.is_zero() {
                    queue.pop_front();
                    continue;
                }
                let qty = min(taker.remaining_quantity, maker.remaining_quantity);
                if !is_positive(qty) {
                    break;
                }
                let notional = *price * qty;
                let taker_fee = notional * Decimal::from(fees.taker_bps) / Decimal::from(10_000u32);
                let maker_fee = notional * Decimal::from(fees.maker_bps.max(0) as u32) / Decimal::from(10_000u32);
                let seq = book.next_seq();
                let trade = Trade::new(
                    book.market.clone(),
                    taker,
                    maker,
                    *price,
                    qty,
                    taker_fee,
                    maker_fee,
                    seq,
                );
                maker.fill(qty);
                taker.fill(qty);
                trades.push(trade);
            }
            if queue.is_empty() {
                empty_prices.push(*price);
            }
            if taker.remaining_quantity.is_zero() {
                break;
            }
        }
        for p in empty_prices {
            opp_book.remove(&p);
        }
    }
}

#[derive(Debug)]
pub struct SubmitResult {
    pub order: Order,
    pub trades: Vec<Trade>,
    pub fully_filled: bool,
}
