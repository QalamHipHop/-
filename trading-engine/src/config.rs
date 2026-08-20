//! Configuration loading for the trading engine.
//!
//! The engine reads a YAML file (default: `./config/trading.yaml`,
//! override with the `TRADING_CONFIG` env var) and then layers
//! environment variables on top for secrets and addresses.

use rust_decimal::Decimal;
use serde::Deserialize;
use std::str::FromStr;

use crate::router::RouterConfig;
use crate::strategy::MarketMakingConfig;

#[derive(Debug, Deserialize, Clone)]
pub struct ServerCfg {
    pub grpc_addr: String,
    pub health_addr: String,
    #[serde(default = "default_shutdown")]
    pub shutdown_grace_seconds: u64,
}
fn default_shutdown() -> u64 {
    15
}

#[derive(Debug, Deserialize, Clone)]
pub struct RoutingCfg {
    #[serde(default)]
    pub default_venues: Vec<String>,
    #[serde(default)]
    pub allow_external_default: bool,
    #[serde(default = "default_max_legs")]
    pub max_legs_per_order: usize,
    #[serde(default = "default_slippage")]
    pub max_slippage_bps: i64,
    #[serde(default = "default_max_notional")]
    pub max_order_notional: String,
}
fn default_max_legs() -> usize {
    1
}
fn default_slippage() -> i64 {
    50
}
fn default_max_notional() -> String {
    "1000000".into()
}

#[derive(Debug, Deserialize, Clone)]
pub struct MarketMakingCfg {
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    #[serde(default = "default_spread")]
    pub default_spread_bps: i64,
    #[serde(default = "default_size")]
    pub default_size: String,
    #[serde(default = "default_skew")]
    pub inventory_skew_factor: String,
    #[serde(default = "default_refresh")]
    pub refresh_interval_ms: u64,
    #[serde(default = "default_max_open")]
    pub max_open_orders_per_symbol: usize,
}
fn default_enabled() -> bool {
    true
}
fn default_spread() -> i64 {
    30
}
fn default_size() -> String {
    "1000".into()
}
fn default_skew() -> String {
    "0.5".into()
}
fn default_refresh() -> u64 {
    500
}
fn default_max_open() -> usize {
    20
}

#[derive(Debug, Deserialize, Clone)]
pub struct RiskCfg {
    #[serde(default = "default_max_notional2")]
    pub max_order_notional: String,
    #[serde(default = "default_max_pos")]
    pub max_position_per_symbol: String,
    #[serde(default = "default_max_loss")]
    pub max_daily_loss: String,
    #[serde(default)]
    pub kill_switch: bool,
}
fn default_max_notional2() -> String {
    "1000000".into()
}
fn default_max_pos() -> String {
    "100000".into()
}
fn default_max_loss() -> String {
    "50000".into()
}

#[derive(Debug, Deserialize, Clone)]
pub struct LoggingCfg {
    #[serde(default = "default_log_level")]
    pub level: String,
    #[serde(default = "default_log_format")]
    pub format: String,
}
fn default_log_level() -> String {
    "info".into()
}
fn default_log_format() -> String {
    "json".into()
}

#[derive(Debug, Deserialize, Clone)]
pub struct AppConfig {
    pub server: ServerCfg,
    pub routing: RoutingCfg,
    pub market_making: MarketMakingCfg,
    pub risk: RiskCfg,
    pub logging: LoggingCfg,
}

impl AppConfig {
    pub fn load() -> anyhow::Result<Self> {
        let path =
            std::env::var("TRADING_CONFIG").unwrap_or_else(|_| "config/trading.yaml".to_string());
        let raw = std::fs::read_to_string(&path)
            .map_err(|e| anyhow::anyhow!("read config {path}: {e}"))?;
        let cfg: AppConfig =
            serde_yaml::from_str(&raw).map_err(|e| anyhow::anyhow!("parse config {path}: {e}"))?;
        Ok(cfg)
    }

    pub fn to_router_config(&self) -> anyhow::Result<RouterConfig> {
        Ok(RouterConfig {
            default_venues: self.routing.default_venues.clone(),
            allow_external_default: self.routing.allow_external_default,
            max_legs_per_order: self.routing.max_legs_per_order,
            max_slippage_bps: self.routing.max_slippage_bps,
            max_order_notional: Decimal::from_str(&self.routing.max_order_notional)
                .map_err(|e| anyhow::anyhow!("bad routing.max_order_notional: {e}"))?,
        })
    }

    pub fn to_mm_config(&self) -> anyhow::Result<MarketMakingConfig> {
        Ok(MarketMakingConfig {
            default_spread_bps: self.market_making.default_spread_bps,
            default_size: Decimal::from_str(&self.market_making.default_size)
                .map_err(|e| anyhow::anyhow!("bad market_making.default_size: {e}"))?,
            inventory_skew_factor: Decimal::from_str(&self.market_making.inventory_skew_factor)
                .map_err(|e| anyhow::anyhow!("bad market_making.inventory_skew_factor: {e}"))?,
            refresh_interval_ms: self.market_making.refresh_interval_ms,
            max_open_orders_per_symbol: self.market_making.max_open_orders_per_symbol,
        })
    }
}
