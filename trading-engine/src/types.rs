//! Core domain types for the trading engine.
//!
//! All money / quantity values use [`rust_decimal::Decimal`] to avoid
//! float drift. We accept the small allocation cost in exchange for
//! exact decimal arithmetic — the matching engine does the same.

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use uuid::Uuid;

use crate::proto::rial::trading::v1 as pb;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Side {
    Buy,
    Sell,
}

impl Side {
    pub fn as_str(self) -> &'static str {
        match self {
            Side::Buy => "BUY",
            Side::Sell => "SELL",
        }
    }
}

impl From<pb::Side> for Side {
    fn from(v: pb::Side) -> Self {
        match v {
            pb::Side::Buy => Side::Buy,
            pb::Side::Sell => Side::Sell,
            _ => Side::Buy, // deterministic default for UNSPECIFIED
        }
    }
}

impl From<Side> for pb::Side {
    fn from(v: Side) -> Self {
        match v {
            Side::Buy => pb::Side::Buy,
            Side::Sell => pb::Side::Sell,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum OrderType {
    Market,
    Limit,
}

impl From<pb::OrderType> for OrderType {
    fn from(v: pb::OrderType) -> Self {
        match v {
            pb::OrderType::Market => OrderType::Market,
            pb::OrderType::Limit => OrderType::Limit,
            _ => OrderType::Market,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimeInForce {
    Gtc,
    Ioc,
    Fok,
}

impl From<pb::TimeInForce> for TimeInForce {
    fn from(v: pb::TimeInForce) -> Self {
        match v {
            pb::TimeInForce::Gtc => TimeInForce::Gtc,
            pb::TimeInForce::Ioc => TimeInForce::Ioc,
            pb::TimeInForce::Fok => TimeInForce::Fok,
            _ => TimeInForce::Gtc,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum StrategyKind {
    PeggedQuotes,
    Twap,
    Vwap,
    InventorySkew,
}

impl From<pb::StrategyKind> for StrategyKind {
    fn from(v: pb::StrategyKind) -> Self {
        match v {
            pb::StrategyKind::PeggedQuotes => StrategyKind::PeggedQuotes,
            pb::StrategyKind::Twap => StrategyKind::Twap,
            pb::StrategyKind::Vwap => StrategyKind::Vwap,
            pb::StrategyKind::InventorySkew => StrategyKind::InventorySkew,
            _ => StrategyKind::PeggedQuotes,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OrderRequest {
    pub client_order_id: String,
    pub user_id: String,
    pub symbol: String,
    pub side: Side,
    pub order_type: OrderType,
    pub tif: TimeInForce,
    pub quantity: Decimal,
    pub price: Option<Decimal>,
    pub venue_hint: Option<String>,
    pub allow_external: bool,
    pub correlation_id: String,
}

impl OrderRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.user_id.trim().is_empty() {
            return Err("user_id required".into());
        }
        if self.symbol.trim().is_empty() {
            return Err("symbol required".into());
        }
        if self.quantity <= Decimal::ZERO {
            return Err("quantity must be > 0".into());
        }
        if matches!(self.order_type, OrderType::Limit) && self.price.is_none() {
            return Err("LIMIT order requires price".into());
        }
        if let Some(p) = self.price {
            if p <= Decimal::ZERO {
                return Err("price must be > 0".into());
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutedLeg {
    pub venue: String,
    pub venue_id: String,
    pub price: Decimal,
    pub quantity: Decimal,
    pub routed_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteResult {
    pub parent_id: String,
    pub status: RouteStatus,
    pub legs: Vec<RoutedLeg>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RouteStatus {
    Accepted,
    Rejected,
    PartiallyFilled,
    Filled,
}

impl RouteStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            RouteStatus::Accepted => "ACCEPTED",
            RouteStatus::Rejected => "REJECTED",
            RouteStatus::PartiallyFilled => "PARTIALLY_FILLED",
            RouteStatus::Filled => "FILLED",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategySpec {
    pub id: String,
    pub kind: StrategyKind,
    pub symbol: String,
    pub enabled: bool,
    pub params: std::collections::BTreeMap<String, String>,
}

impl StrategySpec {
    pub fn new(kind: StrategyKind, symbol: impl Into<String>) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            kind,
            symbol: symbol.into(),
            enabled: true,
            params: Default::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fill {
    pub parent_id: String,
    pub venue_id: String,
    pub symbol: String,
    pub side: Side,
    pub price: Decimal,
    pub quantity: Decimal,
    pub fee: Decimal,
    pub filled_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Quote {
    pub symbol: String,
    pub side: Side,
    pub price: Decimal,
    pub size: Decimal,
    pub issued_at_ms: i64,
}

/// Parse a `Decimal` from a `pb::Decimal.value` field.
pub fn parse_decimal(v: &str) -> Result<Decimal, String> {
    Decimal::from_str(v.trim()).map_err(|e| format!("invalid decimal '{v}': {e}"))
}

pub fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
