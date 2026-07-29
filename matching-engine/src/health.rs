//! Lightweight health/readiness HTTP endpoints on a separate port.

use hyper::body::Incoming;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use hyper::server::conn::http1;
use hyper::service::service_fn;
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use parking_lot::Mutex;

#[derive(Clone)]
pub struct HealthState {
    pub ready: Arc<AtomicBool>,
    pub started_at: Arc<Mutex<chrono::DateTime<chrono::Utc>>>,
}

impl HealthState {
    pub fn new() -> Self {
        Self {
            ready: Arc::new(AtomicBool::new(false)),
            started_at: Arc::new(Mutex::new(chrono::Utc::now())),
        }
    }
    pub fn mark_ready(&self) {
        self.ready.store(true, Ordering::SeqCst);
    }
}

pub async fn serve_health(addr: SocketAddr, state: HealthState) -> anyhow::Result<()> {
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("health listening on {}", addr);
    loop {
        let (stream, _) = listener.accept().await?;
        let io = TokioIo::new(stream);
        let state = state.clone();
        tokio::spawn(async move {
            let svc = service_fn(move |req: Request<Incoming>| {
                let state = state.clone();
                async move {
                    let res = match req.uri().path() {
                        "/healthz" => Response::new("ok".to_string()),
                        "/readyz" => {
                            if state.ready.load(Ordering::SeqCst) {
                                Response::new("ready".to_string())
                            } else {
                                Response::builder()
                                    .status(StatusCode::SERVICE_UNAVAILABLE)
                                    .body("not ready".to_string())
                                    .unwrap()
                            }
                        }
                        _ => Response::builder()
                            .status(StatusCode::NOT_FOUND)
                            .body("not found".to_string())
                            .unwrap(),
                    };
                    Ok::<_, Infallible>(res)
                }
            });
            if let Err(e) = http1::Builder::new().serve_connection(io, svc).await {
                tracing::warn!("health conn error: {e}");
            }
        });
    }
}
