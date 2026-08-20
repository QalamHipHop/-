//! gRPC service implementation for the trading engine.

use std::pin::Pin;
use std::sync::Arc;

use tokio::sync::broadcast;
use tokio_stream::{wrappers::BroadcastStream, Stream, StreamExt};
use tonic::{Request, Response, Status};
use tracing::info;

use crate::proto::rial::trading::v1 as pb;
use crate::router::Router;
use crate::strategy::StrategyEngine;
use crate::types::{now_ms, parse_decimal, Fill, OrderRequest, Quote, RouteStatus, StrategySpec};

pub struct TradingService {
    pub router: Arc<Router>,
    pub strategies: Arc<StrategyEngine>,
    pub fills_tx: broadcast::Sender<Fill>,
    pub metrics_text: Arc<std::sync::RwLock<String>>,
}

impl TradingService {
    pub fn new(router: Arc<Router>, strategies: Arc<StrategyEngine>) -> Self {
        let (fills_tx, _) = broadcast::channel(4096);
        Self {
            router,
            strategies,
            fills_tx,
            metrics_text: Arc::new(std::sync::RwLock::new(String::new())),
        }
    }

    pub fn set_metrics(&self, text: String) {
        if let Ok(mut g) = self.metrics_text.write() {
            *g = text;
        }
    }
}

type FillStream = Pin<Box<dyn Stream<Item = Result<pb::FillEvent, Status>> + Send>>;
type QuoteStream = Pin<Box<dyn Stream<Item = Result<pb::QuoteEvent, Status>> + Send>>;

fn route_status_to_pb(s: RouteStatus) -> &'static str {
    match s {
        RouteStatus::Accepted => "ACCEPTED",
        RouteStatus::Rejected => "REJECTED",
        RouteStatus::PartiallyFilled => "PARTIALLY_FILLED",
        RouteStatus::Filled => "FILLED",
    }
}

fn fill_to_pb(f: &Fill) -> pb::FillEvent {
    pb::FillEvent {
        parent_id: f.parent_id.clone(),
        venue_id: f.venue_id.clone(),
        symbol: f.symbol.clone(),
        side: f.side as i32,
        price: Some(pb::Decimal {
            value: f.price.to_string(),
        }),
        quantity: Some(pb::Decimal {
            value: f.quantity.to_string(),
        }),
        fee: Some(pb::Decimal {
            value: f.fee.to_string(),
        }),
        filled_at_ms: f.filled_at_ms,
    }
}

fn quote_to_pb(q: &Quote) -> pb::QuoteEvent {
    pb::QuoteEvent {
        symbol: q.symbol.clone(),
        side: q.side as i32,
        price: Some(pb::Decimal {
            value: q.price.to_string(),
        }),
        size: Some(pb::Decimal {
            value: q.size.to_string(),
        }),
        issued_at_ms: q.issued_at_ms,
    }
}

#[tonic::async_trait]
impl pb::trading_engine_server::TradingEngine for TradingService {
    async fn route_order(
        &self,
        request: Request<pb::RouteOrderRequest>,
    ) -> Result<Response<pb::RouteOrderResponse>, Status> {
        let r = request.into_inner();
        let req = OrderRequest {
            client_order_id: r.client_order_id,
            user_id: r.user_id,
            symbol: r.symbol,
            side: pb::Side::try_from(r.side)
                .unwrap_or(pb::Side::Unspecified)
                .into(),
            order_type: pb::OrderType::try_from(r.r#type)
                .unwrap_or(pb::OrderType::Market)
                .into(),
            tif: pb::TimeInForce::try_from(r.tif)
                .unwrap_or(pb::TimeInForce::Gtc)
                .into(),
            quantity: r
                .quantity
                .as_ref()
                .map(|d| parse_decimal(&d.value).unwrap_or_default())
                .unwrap_or_default(),
            price: r.price.as_ref().and_then(|d| parse_decimal(&d.value).ok()),
            venue_hint: if r.venue_hint.is_empty() {
                None
            } else {
                Some(r.venue_hint)
            },
            allow_external: r.allow_external,
            correlation_id: r.correlation_id,
        };

        let res = self.router.route(&req);
        let legs: Vec<pb::RoutedLeg> = res
            .legs
            .iter()
            .map(|l| pb::RoutedLeg {
                venue: l.venue.clone(),
                venue_id: l.venue_id.clone(),
                price: Some(pb::Decimal {
                    value: l.price.to_string(),
                }),
                quantity: Some(pb::Decimal {
                    value: l.quantity.to_string(),
                }),
                routed_at_ms: l.routed_at_ms,
            })
            .collect();

        Ok(Response::new(pb::RouteOrderResponse {
            parent_id: res.parent_id,
            status: route_status_to_pb(res.status).to_string(),
            legs,
            reason: res.reason.unwrap_or_default(),
        }))
    }

    async fn cancel_route(
        &self,
        _request: Request<pb::CancelRouteRequest>,
    ) -> Result<Response<pb::CancelRouteResponse>, Status> {
        // The matching engine owns cancel semantics; here we just
        // acknowledge and let the client reconcile.
        Ok(Response::new(pb::CancelRouteResponse {
            cancelled: true,
            reason: "ack".into(),
        }))
    }

    async fn upsert_strategy(
        &self,
        request: Request<pb::UpsertStrategyRequest>,
    ) -> Result<Response<pb::UpsertStrategyResponse>, Status> {
        let r = request.into_inner();
        let s = r
            .strategy
            .ok_or_else(|| Status::invalid_argument("strategy required"))?;
        let spec = StrategySpec {
            id: if s.id.is_empty() {
                uuid::Uuid::new_v4().to_string()
            } else {
                s.id
            },
            kind: pb::StrategyKind::try_from(s.kind)
                .unwrap_or(pb::StrategyKind::PeggedQuotes)
                .into(),
            symbol: s.symbol,
            enabled: s.enabled,
            params: s.params.into_iter().collect(),
        };
        match self.strategies.upsert(spec) {
            Ok(_) => {
                info!("strategy upserted via gRPC");
                Ok(Response::new(pb::UpsertStrategyResponse {
                    accepted: true,
                    reason: String::new(),
                }))
            }
            Err(e) => Ok(Response::new(pb::UpsertStrategyResponse {
                accepted: false,
                reason: e,
            })),
        }
    }

    async fn list_strategies(
        &self,
        request: Request<pb::ListStrategiesRequest>,
    ) -> Result<Response<pb::ListStrategiesResponse>, Status> {
        let r = request.into_inner();
        let sym = if r.symbol.is_empty() {
            None
        } else {
            Some(r.symbol.as_str())
        };
        let items: Vec<pb::StrategySpec> = self
            .strategies
            .list(sym)
            .into_iter()
            .map(|s| pb::StrategySpec {
                id: s.id,
                kind: s.kind as i32,
                symbol: s.symbol,
                enabled: s.enabled,
                params: s.params.into_iter().collect(),
            })
            .collect();
        Ok(Response::new(pb::ListStrategiesResponse {
            strategies: items,
        }))
    }

    async fn disable_strategy(
        &self,
        request: Request<pb::DisableStrategyRequest>,
    ) -> Result<Response<pb::DisableStrategyResponse>, Status> {
        let id = request.into_inner().id;
        if id.is_empty() {
            return Ok(Response::new(pb::DisableStrategyResponse {
                disabled: false,
                reason: "id required".into(),
            }));
        }
        let ok = self.strategies.disable(&id);
        Ok(Response::new(pb::DisableStrategyResponse {
            disabled: ok,
            reason: if ok {
                String::new()
            } else {
                "not found".into()
            },
        }))
    }

    type StreamFillsStream = FillStream;
    async fn stream_fills(
        &self,
        request: Request<pb::StreamFillsRequest>,
    ) -> Result<Response<Self::StreamFillsStream>, Status> {
        let r = request.into_inner();
        let user_filter = if r.user_id.is_empty() {
            None
        } else {
            Some(r.user_id)
        };
        let rx = self.fills_tx.subscribe();
        let s = BroadcastStream::new(rx).filter_map(move |item| {
            let user_filter = user_filter.clone();
            match item {
                Ok(fill) => {
                    if let Some(uid) = &user_filter {
                        // We don't carry user_id on Fill at the moment;
                        // in production the upstream would tag it.
                        // For now, pass through.
                        let _ = uid;
                    }
                    Some(Ok(fill_to_pb(&fill)))
                }
                Err(_) => None,
            }
        });
        Ok(Response::new(Box::pin(s) as Self::StreamFillsStream))
    }

    type StreamQuotesStream = QuoteStream;
    async fn stream_quotes(
        &self,
        request: Request<pb::StreamQuotesRequest>,
    ) -> Result<Response<Self::StreamQuotesStream>, Status> {
        let r = request.into_inner();
        let filter = if r.symbol.is_empty() {
            None
        } else {
            Some(r.symbol)
        };
        let rx = self.strategies.subscribe_quotes();
        let s = BroadcastStream::new(rx).filter_map(move |item| {
            let filter = filter.clone();
            match item {
                Ok(q) => {
                    if let Some(s) = &filter {
                        if &q.symbol != s {
                            return None;
                        }
                    }
                    Some(Ok(quote_to_pb(&q)))
                }
                Err(_) => None,
            }
        });
        Ok(Response::new(Box::pin(s) as Self::StreamQuotesStream))
    }

    async fn health(
        &self,
        _request: Request<pb::HealthRequest>,
    ) -> Result<Response<pb::HealthResponse>, Status> {
        Ok(Response::new(pb::HealthResponse {
            status: "OK".into(),
            uptime_seconds: now_ms() / 1000,
            active_strategies: self.strategies.count_active() as i64,
            open_orders: 0,
        }))
    }

    async fn metrics(
        &self,
        _request: Request<pb::MetricsRequest>,
    ) -> Result<Response<pb::MetricsResponse>, Status> {
        let text = self
            .metrics_text
            .read()
            .map(|s| s.clone())
            .unwrap_or_default();
        Ok(Response::new(pb::MetricsResponse {
            prometheus_text: text,
        }))
    }
}
