//! Prometheus metrics endpoint.

use hyper::body::Incoming;
use hyper::{Request, Response};
use hyper_util::rt::TokioIo;
use metrics_exporter_prometheus::PrometheusHandle;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use hyper::server::conn::http1;
use hyper::service::service_fn;

pub async fn serve_metrics(addr: SocketAddr, handle: PrometheusHandle) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("metrics listening on {}", addr);
    loop {
        let (stream, _) = listener.accept().await?;
        let io = TokioIo::new(stream);
        let handle = handle.clone();
        tokio::spawn(async move {
            let svc = service_fn(move |_req: Request<Incoming>| {
                let body = handle.render();
                async move {
                    Ok::<_, Infallible>(Response::new::<String>(body).map(|b| b.into()))
                }
            });
            if let Err(e) = http1::Builder::new().serve_connection(io, svc).await {
                tracing::warn!("metrics conn error: {e}");
            }
        });
    }
}

pub fn install_recorder() -> PrometheusHandle {
    let builder = metrics_exporter_prometheus::PrometheusBuilder::new();
    builder.install_recorder().expect("metrics recorder")
}

pub fn _silence_arc_unused(_: Arc<()>) {}
