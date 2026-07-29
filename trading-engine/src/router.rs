//! Smart order router.
//!
//! The router does not actually place orders on the matching engine
//! (that is the matching engine's own responsibility); it decides
//! **where** and **how** to split a parent order across one or more
//! venues, applying per-request risk limits and the global config.

use std::collections::BTreeMap;
use std::sync::Arc;

use parking_lot::RwLock;
use rust_decimal::Decimal;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::decimal::{apply_bps, notional};
use crate::types::{
    now_ms, OrderRequest, OrderType, RouteResult, RouteStatus, RoutedLeg, Side, TimeInForce,
};

#[derive(Debug, Clone)]
pub struct RouterConfig {
    pub default_venues: Vec<String>,
    pub allow_external_default: bool,
    pub max_legs_per_order: usize,
    pub max_slippage_bps: i64,
    pub max_order_notional: Decimal,
}

impl Default for RouterConfig {
    fn default() -> Self {
        Self {
            default_venues: vec!["internal:matching".to_string()],
            allow_external_default: false,
            max_legs_per_order: 1,
            max_slippage_bps: 50,
            max_order_notional: Decimal::from(1_000_000),
        }
    }
}

#[derive(Default)]
struct RiskState {
    /// last computed open notional per symbol
    open_notional: BTreeMap<String, Decimal>,
}

#[derive(Clone)]
pub struct Router {
    cfg: Arc<RwLock<RouterConfig>>,
    risk: Arc<RwLock<RiskState>>,
}

impl Router {
    pub fn new(cfg: RouterConfig) -> Self {
        Self {
            cfg: Arc::new(RwLock::new(cfg)),
            risk: Arc::new(RwLock::new(RiskState::default())),
        }
    }

    pub fn config(&self) -> RouterConfig {
        self.cfg.read().clone()
    }

    pub fn update_config(&self, cfg: RouterConfig) {
        *self.cfg.write() = cfg;
    }

    /// Route an order. The result contains zero or more legs, and a
    /// final `status` (Accepted/Rejected/...). The router does not
    /// wait for fills — the gRPC server streams them as they arrive.
    pub fn route(&self, req: &OrderRequest) -> RouteResult {
        if let Err(e) = req.validate() {
            return RouteResult {
                parent_id: String::new(),
                status: RouteStatus::Rejected,
                legs: vec![],
                reason: Some(e),
            };
        }

        let cfg = self.cfg.read().clone();

        // --- Risk checks ------------------------------------------------
        let notional_value = notional(req.price.unwrap_or(Decimal::ONE), req.quantity);
        if notional_value > cfg.max_order_notional {
            return RouteResult {
                parent_id: String::new(),
                status: RouteStatus::Rejected,
                legs: vec![],
                reason: Some(format!(
                    "notional {notional_value} exceeds max {}",
                    cfg.max_order_notional
                )),
            };
        }

        // --- Slippage sanity for MARKET orders --------------------------
        if matches!(req.order_type, OrderType::Market) {
            if let Some(p) = req.price {
                // If client supplied a reference price, ensure it
                // is within a reasonable band of our internal book.
                // We don't have a live book here, so we just record.
                debug!(price = %p, "market order with reference price");
            }
        }

        // --- Pick a venue ----------------------------------------------
        let venue = req
            .venue_hint
            .clone()
            .or_else(|| {
                let allow = req.allow_external || cfg.allow_external_default;
                if allow {
                    cfg.default_venues.first().cloned()
                } else {
                    cfg.default_venues
                        .iter()
                        .find(|v| v.starts_with("internal:"))
                        .cloned()
                        .or_else(|| cfg.default_venues.first().cloned())
                }
            })
            .unwrap_or_else(|| "internal:matching".to_string());

        // For now we always route to a single internal leg. Multi-leg
        // splitting (TWAP/VWAP) is implemented by the strategy engine.
        let leg_price = match req.order_type {
            OrderType::Limit => req.price.unwrap(),
            OrderType::Market => {
                // mark reference as a small adverse offset to be
                // safe; in production this would be the BBO.
                req.price
                    .map(|p| match req.side {
                        Side::Buy => apply_bps(p, cfg.max_slippage_bps / 2),
                        Side::Sell => apply_bps(p, -(cfg.max_slippage_bps / 2)),
                    })
                    .unwrap_or(Decimal::ZERO)
            }
        };

        let parent_id = Uuid::new_v4().to_string();
        let leg = RoutedLeg {
            venue: venue.clone(),
            venue_id: format!("{}:{}", parent_id, 0),
            price: leg_price,
            quantity: req.quantity,
            routed_at_ms: now_ms(),
        };

        // TIF = FOK and MARKET with a price is a no-op for us here
        // (matching engine will validate); we just accept.
        let _ = req.tif == TimeInForce::Fok;

        // --- Track open notional ---------------------------------------
        {
            let mut r = self.risk.write();
            let entry = r
                .open_notional
                .entry(req.symbol.clone())
                .or_insert(Decimal::ZERO);
            *entry += notional_value;
        }

        debug!(parent_id = %parent_id, venue = %venue, "routed order");

        RouteResult {
            parent_id,
            status: RouteStatus::Accepted,
            legs: vec![leg],
            reason: None,
        }
    }

    pub fn release_risk(&self, symbol: &str, notional_value: Decimal) {
        let mut r = self.risk.write();
        if let Some(v) = r.open_notional.get_mut(symbol) {
            *v -= notional_value;
            if *v < Decimal::ZERO {
                warn!(symbol, "risk notional went negative — bookkeeping drift");
                *v = Decimal::ZERO;
            }
        }
    }
}
