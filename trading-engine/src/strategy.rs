//! Strategy engine — runs market-making and execution strategies.
//!
//! Each strategy is identified by `id` and bound to a single `symbol`.
//! Strategies are stored in a concurrent map and executed by a small
//! tokio task that wakes on a fixed interval (or sooner when nudged).

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use parking_lot::RwLock;
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use tokio::sync::Notify;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

use crate::decimal::{apply_bps, apply_bps_down};
use crate::types::parse_decimal;
use crate::types::{now_ms, Quote, Side, StrategyKind, StrategySpec};

#[derive(Debug, Clone)]
pub struct MarketMakingConfig {
    pub default_spread_bps: i64,
    pub default_size: Decimal,
    pub inventory_skew_factor: Decimal,
    pub refresh_interval_ms: u64,
    pub max_open_orders_per_symbol: usize,
}

impl Default for MarketMakingConfig {
    fn default() -> Self {
        Self {
            default_spread_bps: 30,
            default_size: dec!(1000),
            inventory_skew_factor: dec!(0.5),
            refresh_interval_ms: 500,
            max_open_orders_per_symbol: 20,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ReferencePrice {
    pub bid: Decimal,
    pub ask: Decimal,
}

/// Inventory for a single symbol. Positive = net long, negative = net short.
#[derive(Debug, Default, Clone)]
pub struct Inventory {
    pub net_qty: Decimal,
    pub avg_price: Decimal,
}

#[derive(Clone)]
pub struct StrategyEngine {
    strategies: Arc<DashMap<String, StoredStrategy>>,
    mm_cfg: Arc<RwLock<MarketMakingConfig>>,
    inventory: Arc<DashMap<String, Inventory>>,
    refs: Arc<DashMap<String, ReferencePrice>>,
    quotes_tx: Arc<tokio::sync::broadcast::Sender<Quote>>,
    kill: Arc<tokio::sync::Notify>,
}

struct StoredStrategy {
    spec: StrategySpec,
}

impl StrategyEngine {
    pub fn new(mm_cfg: MarketMakingConfig) -> Self {
        let (tx, _rx) = tokio::sync::broadcast::channel(1024);
        Self {
            strategies: Arc::new(DashMap::new()),
            mm_cfg: Arc::new(RwLock::new(mm_cfg)),
            inventory: Arc::new(DashMap::new()),
            refs: Arc::new(DashMap::new()),
            quotes_tx: Arc::new(tx),
            kill: Arc::new(Notify::new()),
        }
    }

    pub fn subscribe_quotes(&self) -> tokio::sync::broadcast::Receiver<Quote> {
        self.quotes_tx.subscribe()
    }

    pub fn mm_config(&self) -> MarketMakingConfig {
        self.mm_cfg.read().clone()
    }

    pub fn set_mm_config(&self, cfg: MarketMakingConfig) {
        *self.mm_cfg.write() = cfg;
    }

    pub fn upsert(&self, spec: StrategySpec) -> Result<bool, String> {
        if spec.symbol.trim().is_empty() {
            return Err("symbol required".into());
        }
        let ok = self
            .strategies
            .insert(spec.id.clone(), StoredStrategy { spec: spec.clone() })
            .is_none();
        info!(strategy_id = %spec.id, kind = ?spec.kind, symbol = %spec.symbol, enabled = spec.enabled, "strategy upserted");
        Ok(ok)
    }

    pub fn disable(&self, id: &str) -> bool {
        if let Some(mut s) = self.strategies.get_mut(id) {
            s.spec.enabled = false;
            info!(strategy_id = %id, "strategy disabled");
            true
        } else {
            false
        }
    }

    pub fn list(&self, symbol: Option<&str>) -> Vec<StrategySpec> {
        self.strategies
            .iter()
            .filter(|e| symbol.map(|s| e.value().spec.symbol == s).unwrap_or(true))
            .map(|e| e.value().spec.clone())
            .collect()
    }

    pub fn count(&self) -> usize {
        self.strategies.len()
    }

    pub fn count_active(&self) -> usize {
        self.strategies.iter().filter(|e| e.value().spec.enabled).count()
    }

    /// Update inventory when a fill arrives.
    pub fn on_fill(&self, symbol: &str, side: Side, qty: Decimal, price: Decimal) {
        let mut inv = self.inventory.entry(symbol.to_string()).or_default();
        let signed = match side {
            Side::Buy => qty,
            Side::Sell => -qty,
        };
        let new_qty = inv.net_qty + signed;
        if inv.net_qty == Decimal::ZERO {
            inv.avg_price = price;
        } else if (inv.net_qty > Decimal::ZERO && signed > Decimal::ZERO)
            || (inv.net_qty < Decimal::ZERO && signed < Decimal::ZERO)
        {
            // adding to existing position — weighted avg
            let total_cost = inv.avg_price * inv.net_qty.abs() + price * signed.abs();
            inv.avg_price = total_cost / inv.net_qty.abs();
        } else {
            // reducing or flipping
            if new_qty == Decimal::ZERO {
                inv.avg_price = Decimal::ZERO;
            }
        }
        inv.net_qty = new_qty;
    }

    pub fn inventory(&self, symbol: &str) -> Inventory {
        self.inventory
            .get(symbol)
            .map(|e| e.value().clone())
            .unwrap_or_default()
    }

    pub fn set_reference(&self, symbol: &str, bid: Decimal, ask: Decimal) {
        self.refs.insert(
            symbol.to_string(),
            ReferencePrice { bid, ask },
        );
    }

    pub fn reference(&self, symbol: &str) -> Option<ReferencePrice> {
        self.refs.get(symbol).map(|e| e.value().clone())
    }

    /// One tick of strategy execution. Emits a vector of quotes.
    pub fn tick(&self) -> Vec<Quote> {
        let cfg = self.mm_cfg.read().clone();
        let mut out = Vec::new();
        let now = now_ms();

        for entry in self.strategies.iter() {
            let s = &entry.value().spec;
            if !s.enabled {
                continue;
            }

            match s.kind {
                StrategyKind::PeggedQuotes | StrategyKind::InventorySkew => {
                    let mid = match self.refs.get(&s.symbol) {
                        Some(r) => (r.bid + r.ask) / dec!(2),
                        None => {
                            debug!(symbol = %s.symbol, "no reference price, skipping peg");
                            continue;
                        }
                    };
                    let inv = self.inventory(&s.symbol);
                    let skew = inv.net_qty * cfg.inventory_skew_factor;
                    let bid = apply_bps_down(mid - skew, cfg.default_spread_bps / 2);
                    let ask = apply_bps(mid - skew, cfg.default_spread_bps / 2);
                    let size = s
                        .params
                        .get("size")
                        .and_then(|v| parse_decimal(v).ok())
                        .unwrap_or(cfg.default_size);

                    out.push(Quote {
                        symbol: s.symbol.clone(),
                        side: Side::Buy,
                        price: bid,
                        size,
                        issued_at_ms: now,
                    });
                    out.push(Quote {
                        symbol: s.symbol.clone(),
                        side: Side::Sell,
                        price: ask,
                        size,
                        issued_at_ms: now,
                    });
                }
                StrategyKind::Twap | StrategyKind::Vwap => {
                    // TWAP/VWAP execution is driven by the executor,
                    // not the per-tick quoter. Nothing to emit here.
                }
            }
        }
        out
    }

    /// Spawn the background loop. The returned `Notify` can be used
    /// to request a graceful stop.
    pub fn spawn_loop(self: Arc<Self>) -> Arc<Notify> {
        let me = self.clone();
        let kill = self.kill.clone();
        let interval = {
            let cfg = self.mm_cfg.read();
            Duration::from_millis(cfg.refresh_interval_ms.max(50))
        };
        let kill_for_task = kill.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(interval);
            loop {
                tokio::select! {
                    _ = kill_for_task.notified() => {
                        info!("strategy loop stopping");
                        break;
                    }
                    _ = tick.tick() => {
                        let quotes = me.tick();
                        for q in quotes {
                            if me.quotes_tx.receiver_count() == 0 {
                                continue;
                            }
                            // ignore send errors — there are no live subs
                            let _ = me.quotes_tx.send(q);
                        }
                    }
                }
            }
        });
        kill
    }
}

impl Drop for StrategyEngine {
    fn drop(&mut self) {
        self.kill.notify_waiters();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_engine() -> StrategyEngine {
        StrategyEngine::new(MarketMakingConfig::default())
    }

    #[test]
    fn upsert_and_list() {
        let e = make_engine();
        let mut s = StrategySpec::new(StrategyKind::PeggedQuotes, "RIAL/USDT");
        s.id = "abc".into();
        e.upsert(s).unwrap();
        assert_eq!(e.list(None).len(), 1);
        assert_eq!(e.list(Some("nope")).len(), 0);
    }

    #[test]
    fn disable_strategy() {
        let e = make_engine();
        let mut s = StrategySpec::new(StrategyKind::PeggedQuotes, "RIAL/USDT");
        s.id = "abc".into();
        e.upsert(s).unwrap();
        assert!(e.disable("abc"));
        assert!(!e.list(None)[0].enabled);
    }

    #[test]
    fn inventory_update() {
        let e = make_engine();
        e.on_fill("RIAL/USDT", Side::Buy, dec!(10), dec!(100));
        assert_eq!(e.inventory("RIAL/USDT").net_qty, dec!(10));
        assert_eq!(e.inventory("RIAL/USDT").avg_price, dec!(100));

        e.on_fill("RIAL/USDT", Side::Sell, dec!(4), dec!(110));
        let inv = e.inventory("RIAL/USDT");
        assert_eq!(inv.net_qty, dec!(6));
    }

    #[test]
    fn tick_emits_quotes_with_reference() {
        let e = make_engine();
        e.set_reference("RIAL/USDT", dec!(99), dec!(101));
        let mut s = StrategySpec::new(StrategyKind::PeggedQuotes, "RIAL/USDT");
        s.id = "abc".into();
        e.upsert(s).unwrap();
        let quotes = e.tick();
        assert_eq!(quotes.len(), 2);
        assert!(quotes.iter().any(|q| q.side == Side::Buy));
        assert!(quotes.iter().any(|q| q.side == Side::Sell));
    }
}
