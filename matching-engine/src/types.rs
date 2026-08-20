//! Domain types — order, trade, side, enums.

use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Side {
    Buy,
    Sell,
}

impl Side {
    #[allow(dead_code)]
    pub fn opposite(self) -> Self {
        match self {
            Side::Buy => Side::Sell,
            Side::Sell => Side::Buy,
        }
    }
}

impl fmt::Display for Side {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Side::Buy => write!(f, "BUY"),
            Side::Sell => write!(f, "SELL"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum OrderType {
    Market,
    Limit,
    Iceberg,
    Stop,
    StopLimit,
    TrailingStop,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum TimeInForce {
    Gtc,
    Ioc,
    Fok,
    Gtd,
    Day,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum OrderStatus {
    New,
    PartiallyFilled,
    Filled,
    Canceled,
    Rejected,
    Expired,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Order {
    pub id: String,
    pub client_order_id: Option<String>,
    pub market: String,
    pub user_id: String,
    pub side: Side,
    pub order_type: OrderType,
    pub tif: TimeInForce,
    pub price: Option<Decimal>,
    pub quantity: Decimal,
    pub filled_quantity: Decimal,
    pub remaining_quantity: Decimal,
    pub stop_price: Option<Decimal>,
    pub trailing_delta: Option<Decimal>,
    pub iceberg_visible_qty: Option<Decimal>,
    pub status: OrderStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub sequence: u64,
}

#[allow(dead_code)]
impl Order {
    pub fn new_limit(
        market: impl Into<String>,
        user_id: impl Into<String>,
        side: Side,
        price: Decimal,
        quantity: Decimal,
        tif: TimeInForce,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            client_order_id: None,
            market: market.into(),
            user_id: user_id.into(),
            side,
            order_type: OrderType::Limit,
            tif,
            price: Some(price),
            quantity,
            filled_quantity: Decimal::ZERO,
            remaining_quantity: quantity,
            stop_price: None,
            trailing_delta: None,
            iceberg_visible_qty: None,
            status: OrderStatus::New,
            created_at: now,
            updated_at: now,
            sequence: 0,
        }
    }

    pub fn new_market(
        market: impl Into<String>,
        user_id: impl Into<String>,
        side: Side,
        quantity: Decimal,
    ) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4().to_string(),
            client_order_id: None,
            market: market.into(),
            user_id: user_id.into(),
            side,
            order_type: OrderType::Market,
            tif: TimeInForce::Ioc,
            price: None,
            quantity,
            filled_quantity: Decimal::ZERO,
            remaining_quantity: quantity,
            stop_price: None,
            trailing_delta: None,
            iceberg_visible_qty: None,
            status: OrderStatus::New,
            created_at: now,
            updated_at: now,
            sequence: 0,
        }
    }

    pub fn is_buy(&self) -> bool {
        matches!(self.side, Side::Buy)
    }

    pub fn is_sell(&self) -> bool {
        matches!(self.side, Side::Sell)
    }

    pub fn fill(&mut self, qty: Decimal) {
        self.filled_quantity += qty;
        self.remaining_quantity = self.quantity - self.filled_quantity;
        self.updated_at = Utc::now();
        if self.remaining_quantity.is_zero() {
            self.status = OrderStatus::Filled;
        } else {
            self.status = OrderStatus::PartiallyFilled;
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Trade {
    pub id: String,
    pub market: String,
    pub buyer_order_id: String,
    pub seller_order_id: String,
    pub buyer_user_id: String,
    pub seller_user_id: String,
    pub taker_side: Side,
    pub price: Decimal,
    pub quantity: Decimal,
    pub taker_fee: Decimal,
    pub maker_fee: Decimal,
    pub taker_fee_asset: String,
    pub maker_fee_asset: String,
    pub executed_at: DateTime<Utc>,
    pub sequence: u64,
}

impl Trade {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        market: impl Into<String>,
        taker: &Order,
        maker: &Order,
        price: Decimal,
        quantity: Decimal,
        taker_fee: Decimal,
        maker_fee: Decimal,
        sequence: u64,
    ) -> Self {
        let (buyer_order_id, seller_order_id, buyer_user_id, seller_user_id, taker_side) =
            if taker.is_buy() {
                (
                    taker.id.clone(),
                    maker.id.clone(),
                    taker.user_id.clone(),
                    maker.user_id.clone(),
                    Side::Buy,
                )
            } else {
                (
                    maker.id.clone(),
                    taker.id.clone(),
                    maker.user_id.clone(),
                    taker.user_id.clone(),
                    Side::Sell,
                )
            };

        Self {
            id: Uuid::new_v4().to_string(),
            market: market.into(),
            buyer_order_id,
            seller_order_id,
            buyer_user_id,
            seller_user_id,
            taker_side,
            price,
            quantity,
            taker_fee,
            maker_fee,
            taker_fee_asset: "RIAL".to_string(),
            maker_fee_asset: "RIAL".to_string(),
            executed_at: Utc::now(),
            sequence,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceLevel {
    pub price: Decimal,
    pub quantity: Decimal,
    pub order_count: u32,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct OrderBookSnapshot {
    pub market: String,
    pub bids: Vec<PriceLevel>,
    pub asks: Vec<PriceLevel>,
    pub sequence: u64,
    pub as_of: DateTime<Utc>,
}
