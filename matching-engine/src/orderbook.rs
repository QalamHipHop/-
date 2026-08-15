//! Order book — price-time priority (FIFO within a price level).
//!
//! Bids kept sorted descending by price, asks sorted ascending.
//! Within the same price, orders are stored in arrival order (FIFO).

use crate::types::{Order, OrderStatus, PriceLevel, Side};
use rust_decimal::Decimal;
use std::collections::{BTreeMap, VecDeque};

/// Per-price FIFO queue of orders.
type Queue = VecDeque<Order>;

#[derive(Debug, Default)]
pub struct OrderBook {
    pub market: String,
    /// Bids: price -> orders at that price (best bid = highest price).
    pub bids: BTreeMap<Decimal, Queue>,
    /// Asks: price -> orders at that price (best ask = lowest price).
    pub asks: BTreeMap<Decimal, Queue>,
    pub sequence: u64,
}

impl OrderBook {
    pub fn new(market: impl Into<String>) -> Self {
        Self {
            market: market.into(),
            bids: BTreeMap::new(),
            asks: BTreeMap::new(),
            sequence: 0,
        }
    }

    pub fn best_bid(&self) -> Option<Decimal> {
        self.bids.keys().next_back().copied()
    }

    pub fn best_ask(&self) -> Option<Decimal> {
        self.asks.keys().next().copied()
    }

    pub fn snapshot(&self, depth: usize) -> (Vec<PriceLevel>, Vec<PriceLevel>) {
        let bids: Vec<PriceLevel> = self
            .bids
            .iter()
            .rev()
            .take(depth)
            .map(|(p, q)| PriceLevel {
                price: *p,
                quantity: q.iter().map(|o| o.remaining_quantity).sum(),
                order_count: q.len() as u32,
            })
            .collect();
        let asks: Vec<PriceLevel> = self
            .asks
            .iter()
            .take(depth)
            .map(|(p, q)| PriceLevel {
                price: *p,
                quantity: q.iter().map(|o| o.remaining_quantity).sum(),
                order_count: q.len() as u32,
            })
            .collect();
        (bids, asks)
    }

    /// Insert a resting (non-taker) order into the book.
    /// Caller must have already determined the order is a maker (won't cross).
    pub fn insert_resting(&mut self, mut order: Order) {
        order.sequence = self.next_seq();
        let price = match order.price {
            Some(p) => p,
            None => return, // market orders don't rest
        };
        let book = match order.side {
            Side::Buy => &mut self.bids,
            Side::Sell => &mut self.asks,
        };
        book.entry(price).or_default().push_back(order);
    }

    /// Remove a resting order by ID. Returns the removed order if found.
    pub fn remove(&mut self, _market: &str, order_id: &str) -> Option<Order> {
        let mut sequence = self.sequence;
        let mut found = None;
        'books: for book in [&mut self.bids, &mut self.asks] {
            let mut empty: Vec<Decimal> = Vec::new();
            for (price, queue) in book.iter_mut() {
                if let Some(pos) = queue.iter().position(|o| o.id == order_id) {
                    let mut removed = queue.remove(pos).expect("position belongs to queue");
                    sequence += 1;
                    removed.status = OrderStatus::Canceled;
                    removed.sequence = sequence;
                    found = Some(removed);
                    if queue.is_empty() {
                        empty.push(*price);
                    }
                    for price in empty {
                        book.remove(&price);
                    }
                    break 'books;
                }
                if queue.is_empty() {
                    empty.push(*price);
                }
            }
            for price in empty {
                book.remove(&price);
            }
        }
        self.sequence = sequence;
        found
    }

    /// Remove all resting orders for a user. Returns the canceled orders.
    pub fn remove_user(&mut self, user_id: &str, market_filter: Option<&str>) -> Vec<Order> {
        let mut out = Vec::new();
        let mut sequence = self.sequence;
        for book in [&mut self.bids, &mut self.asks] {
            let mut empty: Vec<Decimal> = Vec::new();
            for (price, queue) in book.iter_mut() {
                queue.retain_mut(|o| {
                    if o.user_id == user_id
                        && (market_filter.is_none() || market_filter == Some(o.market.as_str()))
                    {
                        sequence += 1;
                        o.status = OrderStatus::Canceled;
                        o.sequence = sequence;
                        out.push(o.clone());
                        false
                    } else {
                        true
                    }
                });
                if queue.is_empty() {
                    empty.push(*price);
                }
            }
            for price in empty {
                book.remove(&price);
            }
        }
        self.sequence = sequence;
        out
    }

    pub fn next_seq(&mut self) -> u64 {
        self.sequence += 1;
        self.sequence
    }
}
