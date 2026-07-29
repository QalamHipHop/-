//! Trading engine entry point.

use std::sync::Arc;
use std::time::Instant;

use anyhow::Context;
use tokio::net::TcpListener;
use tokio::signal::unix::{signal, SignalKind};
use tonic::transport::Server;
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use trading_engine::config::{AppConfig, LoggingCfg};
use trading_engine::health::{serve as serve_health, HealthState};
use trading_engine::metrics::Metrics;
use trading_engine::proto::rial::trading::v1::trading_engine_server::TradingEngineServer;
use trading_engine::router::Router;
use trading_engine::service::TradingService;
use trading_engine::strategy::StrategyEngine;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // --- Logging -----------------------------------------------------
    let cfg = AppConfig::load().context("load config")?;
    init_tracing(&cfg.logging);

    info!(grpc = %cfg.server.grpc_addr, health = %cfg.server.health_addr, "starting trading-engine");

    // --- Metrics -----------------------------------------------------
    let metrics = Arc::new(Metrics::install().context("install prometheus recorder")?);

    // --- Core components --------------------------------------------
    let router = Arc::new(Router::new(cfg.to_router_config()?));
    let strategies = Arc::new(StrategyEngine::new(cfg.to_mm_config()?));
    let svc = TradingService::new(router.clone(), strategies.clone());
    svc.set_metrics(metrics.render());

    // --- Strategy loop ----------------------------------------------
    if cfg.market_making.enabled {
        let kill = strategies.clone().spawn_loop();
        // we don't await kill here — the engine stops it via Drop.
        let _ = kill;
    }

    // --- gRPC server ------------------------------------------------
    let grpc_addr: std::net::SocketAddr = cfg
        .server
        .grpc_addr
        .parse()
        .with_context(|| format!("bad grpc addr {}", cfg.server.grpc_addr))?;
    let listener = TcpListener::bind(grpc_addr)
        .await
        .with_context(|| format!("bind grpc {grpc_addr}"))?;

    let health_addr: std::net::SocketAddr = cfg
        .server
        .health_addr
        .parse()
        .with_context(|| format!("bad health addr {}", cfg.server.health_addr))?;

    let health_state = HealthState {
        started_at: Instant::now(),
        metrics: metrics.clone(),
        active_strategies: Arc::new(move || strategies.count_active()),
        open_orders: Arc::new(move || 0),
    };

    let health_handle = tokio::spawn(async move {
        if let Err(e) = serve_health(health_addr, health_state).await {
            warn!(error = %e, "health server stopped");
        }
    });

    // --- Shutdown wiring --------------------------------------------
    let mut sigterm = signal(SignalKind::terminate())?;
    let mut sigint = signal(SignalKind::interrupt())?;

    let server = Server::builder()
        .add_service(TradingEngineServer::new(svc))
        .serve_with_incoming(tokio_stream::wrappers::TcpListenerStream::new(listener));

    tokio::select! {
        res = server => {
            res.context("grpc server")?;
        }
        _ = sigterm.recv() => info!("SIGTERM received"),
        _ = sigint.recv()  => info!("SIGINT received"),
    }

    info!("graceful shutdown");
    health_handle.abort();
    Ok(())
}

fn init_tracing(cfg: &trading_engine::config::LoggingCfg) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new(format!("trading_engine={}", cfg.level)));
    match cfg.format.as_str() {
        "pretty" => {
            tracing_subscriber::fmt()
                .with_env_filter(filter)
                .with_target(true)
                .init();
        }
        _ => {
            tracing_subscriber::fmt()
                .with_env_filter(filter)
                .with_target(true)
                .json()
                .init();
        }
    }
}
