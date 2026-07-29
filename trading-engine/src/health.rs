//! Tiny HTTP server exposing `/healthz` and `/metrics`.

use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;

use http_body_util::Full;
use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use tokio::net::TcpListener;
use tracing::{info, warn};

use crate::metrics::Metrics;

#[derive(Clone)]
pub struct HealthState {
    pub started_at: std::time::Instant,
    pub metrics: Arc<Metrics>,
    pub active_strategies: Arc<dyn Fn() -> usize + Send + Sync>,
    pub open_orders: Arc<dyn Fn() -> usize + Send + Sync>,
}

pub async fn serve(addr: SocketAddr, state: HealthState) -> anyhow::Result<()> {
    let listener = TcpListener::bind(addr).await?;
    info!(%addr, "health server listening");
    loop {
        let (stream, _) = listener.accept().await?;
        let io = TokioIo::new(stream);
        let st = state.clone();
        tokio::spawn(async move {
            if let Err(e) = hyper::server::conn::http1::Builder::new()
                .serve_connection(io, service_fn(move |req| handle(req, st.clone())))
                .await
            {
                warn!(error = %e, "http connection error");
            }
        });
    }
}

async fn handle(
    req: Request<hyper::body::Incoming>,
    state: HealthState,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let path = req.uri().path();
    let resp = match (req.method(), path) {
        (&Method::GET, "/healthz") => {
            let body = format!(
                r#"{{"status":"OK","uptime_seconds":{},"active_strategies":{},"open_orders":{}}}"#,
                state.started_at.elapsed().as_secs(),
                (state.active_strategies)(),
                (state.open_orders)(),
            );
            Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "application/json")
                .body(Full::new(Bytes::from(body)))
                .unwrap()
        }
        (&Method::GET, "/metrics") => {
            let body = state.metrics.render();
            Response::builder()
                .status(StatusCode::OK)
                .header("content-type", "text/plain; version=0.0.4")
                .body(Full::new(Bytes::from(body)))
                .unwrap()
        }
        _ => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Full::new(Bytes::from("not found")))
            .unwrap(),
    };
    Ok(resp)
}
