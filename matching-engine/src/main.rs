//! Matching engine entry point.

mod decimal;
mod health;
mod matcher;
mod metrics;
mod orderbook;
mod proto;
mod service;
mod types;

use crate::matcher::{Engine, FeeSchedule};
use crate::service::MatchingService;
use std::net::SocketAddr;
use std::sync::Arc;
use tonic::transport::Server;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let grpc_addr: SocketAddr = std::env::var("MATCHING_GRPC_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:50051".to_string())
        .parse()?;
    let health_addr: SocketAddr = std::env::var("MATCHING_HEALTH_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8081".to_string())
        .parse()?;
    let metrics_addr: SocketAddr = std::env::var("MATCHING_METRICS_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:9101".to_string())
        .parse()?;

    let prom = metrics::install_recorder();
    let health_state = health::HealthState::new();

    let engine = Arc::new(Engine::new(FeeSchedule::default()));
    let svc = MatchingService::new(engine);

    tracing::info!(
        "matching-engine v{} starting — grpc={} health={} metrics={}",
        env!("CARGO_PKG_VERSION"),
        grpc_addr,
        health_addr,
        metrics_addr
    );

    health_state.mark_ready();

    let health_state_bg = health_state.clone();
    let metrics_bg = prom.clone();

    let grpc = tokio::spawn(async move {
        Server::builder()
            .add_service(proto::MatchingEngineServer::new(svc))
            .serve(grpc_addr)
            .await
            .expect("grpc server failed");
    });
    let h = tokio::spawn(async move { let _ = health::serve_health(health_addr, health_state_bg).await; });
    let m = tokio::spawn(async move { let _ = metrics::serve_metrics(metrics_addr, metrics_bg).await; });

    let _ = tokio::join!(grpc, h, m);
    Ok(())
}

fn init_tracing() {
    use tracing_subscriber::{EnvFilter, fmt, prelude::*};
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,matching_engine=debug"));
    tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().json().with_target(true))
        .init();
}
