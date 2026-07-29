//! Prometheus metrics for the trading engine.

use std::sync::OnceLock;

use metrics::{counter, gauge, histogram};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};

pub struct Metrics {
    handle: PrometheusHandle,
}

impl Metrics {
    pub fn install() -> Result<Self, Box<dyn std::error::Error>> {
        let builder = PrometheusBuilder::new();
        let handle = builder.install_recorder()?;
        Ok(Self { handle })
    }

    pub fn handle(&self) -> &PrometheusHandle {
        &self.handle
    }

    pub fn render(&self) -> String {
        self.handle.render()
    }
}

pub fn inc_orders_routed(venue: &str) {
    counter!("trading_orders_routed_total", "venue" => venue.to_string()).increment(1);
}

pub fn inc_orders_rejected(reason: &str) {
    counter!("trading_orders_rejected_total", "reason" => reason.to_string()).increment(1);
}

pub fn inc_fills() {
    counter!("trading_fills_total").increment(1);
}

pub fn set_active_strategies(n: usize) {
    gauge!("trading_active_strategies").set(n as f64);
}

pub fn set_open_orders(n: usize) {
    gauge!("trading_open_orders").set(n as f64);
}

pub fn observe_route_latency_ms(ms: f64) {
    histogram!("trading_route_latency_ms").record(ms);
}

/// Return a Prometheus text dump, or an empty string if no recorder
/// has been installed (e.g. in tests). We keep a process-wide handle
/// so callers without a `Metrics` instance can still render.
static GLOBAL: OnceLock<PrometheusHandle> = OnceLock::new();

pub fn install_global() -> Result<(), Box<dyn std::error::Error>> {
    let handle = PrometheusBuilder::new().install_recorder()?;
    let _ = GLOBAL.set(handle);
    Ok(())
}

pub fn render_or_empty() -> String {
    GLOBAL.get().map(|h| h.render()).unwrap_or_default()
}
