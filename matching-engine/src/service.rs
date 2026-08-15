//! gRPC service implementation bridging proto types to the engine.

use crate::decimal::dec;
use crate::matcher::Engine;
use crate::proto;
use crate::types::{Order, OrderStatus, OrderType, Side, TimeInForce};
use rust_decimal::Decimal;
use std::sync::Arc;
use tonic::{Request, Response, Status};

pub struct MatchingService {
    pub engine: Arc<Engine>,
}

impl MatchingService {
    pub fn new(engine: Arc<Engine>) -> Self {
        Self { engine }
    }
}

fn order_to_proto(o: &Order) -> proto::Order {
    proto::Order {
        id: o.id.clone(),
        client_order_id: o.client_order_id.clone().unwrap_or_default(),
        market: o.market.clone(),
        user_id: o.user_id.clone(),
        side: match o.side {
            Side::Buy => proto::Side::Buy as i32,
            Side::Sell => proto::Side::Sell as i32,
            _ => proto::Side::Unspecified as i32,
        },
        r#type: match o.order_type {
            OrderType::Market => proto::OrderType::Market as i32,
            OrderType::Limit => proto::OrderType::Limit as i32,
            OrderType::Iceberg => proto::OrderType::Iceberg as i32,
            OrderType::Stop => proto::OrderType::Stop as i32,
            OrderType::StopLimit => proto::OrderType::StopLimit as i32,
            OrderType::TrailingStop => proto::OrderType::TrailingStop as i32,
        },
        tif: match o.tif {
            TimeInForce::Gtc => proto::TimeInForce::Gtc as i32,
            TimeInForce::Ioc => proto::TimeInForce::Ioc as i32,
            TimeInForce::Fok => proto::TimeInForce::Fok as i32,
            TimeInForce::Gtd => proto::TimeInForce::Gtd as i32,
            TimeInForce::Day => proto::TimeInForce::Day as i32,
        },
        price: o.price.map(|p| p.to_string()).unwrap_or_default(),
        quantity: o.quantity.to_string(),
        filled_quantity: o.filled_quantity.to_string(),
        remaining_quantity: o.remaining_quantity.to_string(),
        stop_price: o.stop_price.map(|p| p.to_string()).unwrap_or_default(),
        trailing_delta: o.trailing_delta.map(|p| p.to_string()).unwrap_or_default(),
        iceberg_visible_qty: o.iceberg_visible_qty.map(|p| p.to_string()).unwrap_or_default(),
        status: match o.status {
            OrderStatus::New => proto::OrderStatus::New as i32,
            OrderStatus::PartiallyFilled => proto::OrderStatus::PartiallyFilled as i32,
            OrderStatus::Filled => proto::OrderStatus::Filled as i32,
            OrderStatus::Canceled => proto::OrderStatus::Canceled as i32,
            OrderStatus::Rejected => proto::OrderStatus::Rejected as i32,
            OrderStatus::Expired => proto::OrderStatus::Expired as i32,
        },
        created_at: Some(prost_types::Timestamp {
            seconds: o.created_at.timestamp(),
            nanos: o.created_at.timestamp_subsec_nanos() as i32,
        }),
        updated_at: Some(prost_types::Timestamp {
            seconds: o.updated_at.timestamp(),
            nanos: o.updated_at.timestamp_subsec_nanos() as i32,
        }),
        sequence: o.sequence,
    }
}

fn trade_to_proto(t: &crate::types::Trade) -> proto::Trade {
    proto::Trade {
        id: t.id.clone(),
        market: t.market.clone(),
        buyer_order_id: t.buyer_order_id.clone(),
        seller_order_id: t.seller_order_id.clone(),
        buyer_user_id: t.buyer_user_id.clone(),
        seller_user_id: t.seller_user_id.clone(),
        taker_side: match t.taker_side {
            Side::Buy => proto::Side::Buy as i32,
            Side::Sell => proto::Side::Sell as i32,
            _ => proto::Side::Unspecified as i32,
        },
        price: t.price.to_string(),
        quantity: t.quantity.to_string(),
        taker_fee: t.taker_fee.to_string(),
        maker_fee: t.maker_fee.to_string(),
        taker_fee_asset: t.taker_fee_asset.clone(),
        maker_fee_asset: t.maker_fee_asset.clone(),
        executed_at: Some(prost_types::Timestamp {
            seconds: t.executed_at.timestamp(),
            nanos: t.executed_at.timestamp_subsec_nanos() as i32,
        }),
        sequence: t.sequence,
    }
}

fn proto_to_order(p: &proto::Order) -> Result<Order, Status> {
    let side = match p.side {
        x if x == proto::Side::Buy as i32 => Side::Buy,
        x if x == proto::Side::Sell as i32 => Side::Sell,
        _ => return Err(Status::invalid_argument("invalid side")),
    };
    let order_type = match p.r#type {
        x if x == proto::OrderType::Market as i32 => OrderType::Market,
        x if x == proto::OrderType::Limit as i32 => OrderType::Limit,
        x if x == proto::OrderType::Iceberg as i32 => OrderType::Iceberg,
        x if x == proto::OrderType::Stop as i32 => OrderType::Stop,
        x if x == proto::OrderType::StopLimit as i32 => OrderType::StopLimit,
        x if x == proto::OrderType::TrailingStop as i32 => OrderType::TrailingStop,
        _ => return Err(Status::invalid_argument("invalid order type")),
    };
    let tif = match p.tif {
        x if x == proto::TimeInForce::Gtc as i32 => TimeInForce::Gtc,
        x if x == proto::TimeInForce::Ioc as i32 => TimeInForce::Ioc,
        x if x == proto::TimeInForce::Fok as i32 => TimeInForce::Fok,
        x if x == proto::TimeInForce::Gtd as i32 => TimeInForce::Gtd,
        x if x == proto::TimeInForce::Day as i32 => TimeInForce::Day,
        _ => return Err(Status::invalid_argument("invalid time in force")),
    };
    let price = if p.price.is_empty() { None } else { Some(dec(&p.price)) };
    let quantity: Decimal = if p.quantity.is_empty() {
        return Err(Status::invalid_argument("quantity required"));
    } else {
        dec(&p.quantity)
    };
    Ok(Order {
        id: if p.id.is_empty() { uuid::Uuid::new_v4().to_string() } else { p.id.clone() },
        client_order_id: if p.client_order_id.is_empty() { None } else { Some(p.client_order_id.clone()) },
        market: p.market.clone(),
        user_id: p.user_id.clone(),
        side,
        order_type,
        tif,
        price,
        quantity,
        filled_quantity: dec(&p.filled_quantity),
        remaining_quantity: quantity - dec(&p.filled_quantity),
        stop_price: if p.stop_price.is_empty() { None } else { Some(dec(&p.stop_price)) },
        trailing_delta: if p.trailing_delta.is_empty() { None } else { Some(dec(&p.trailing_delta)) },
        iceberg_visible_qty: if p.iceberg_visible_qty.is_empty() { None } else { Some(dec(&p.iceberg_visible_qty)) },
        status: OrderStatus::New,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
        sequence: 0,
    })
}

#[tonic::async_trait]
impl proto::matching_engine_server::MatchingEngine for MatchingService {
    async fn ping(&self, _req: Request<proto::PingRequest>) -> Result<Response<proto::PongResponse>, Status> {
        Ok(Response::new(proto::PongResponse {
            version: env!("CARGO_PKG_VERSION").to_string(),
            uptime_secs: 0,
        }))
    }

    async fn submit_order(
        &self,
        req: Request<proto::SubmitOrderRequest>,
    ) -> Result<Response<proto::SubmitOrderResponse>, Status> {
        let order = proto_to_order(req.get_ref().order.as_ref().ok_or_else(|| Status::invalid_argument("order required"))?)?;
        let result = self.engine.submit(order);
        Ok(Response::new(proto::SubmitOrderResponse {
            order: Some(order_to_proto(&result.order)),
            trades: result.trades.iter().map(trade_to_proto).collect(),
            status_updates: vec![],
        }))
    }

    async fn cancel_order(
        &self,
        req: Request<proto::CancelOrderRequest>,
    ) -> Result<Response<proto::CancelOrderResponse>, Status> {
        let r = req.get_ref();
        let order = self
            .engine
            .cancel(&r.market, &r.order_id)
            .ok_or_else(|| Status::not_found("order not found"))?;
        Ok(Response::new(proto::CancelOrderResponse {
            canceled: true,
            order: Some(order_to_proto(&order)),
        }))
    }

    async fn cancel_all(
        &self,
        req: Request<proto::CancelAllRequest>,
    ) -> Result<Response<proto::CancelAllResponse>, Status> {
        let r = req.get_ref();
        let orders = self.engine.cancel_all(&r.user_id, if r.market.is_empty() { None } else { Some(r.market.as_str()) });
        let ids: Vec<String> = orders.iter().map(|o| o.id.clone()).collect();
        Ok(Response::new(proto::CancelAllResponse {
            canceled_count: orders.len() as u32,
            order_ids: ids,
        }))
    }

    async fn get_order(
        &self,
        req: Request<proto::GetOrderRequest>,
    ) -> Result<Response<proto::GetOrderResponse>, Status> {
        let r = req.get_ref();
        let m = self.engine.market(&r.market).ok_or_else(|| Status::not_found("market not found"))?;
        let m = m.lock();
        for book in [&m.book.bids, &m.book.asks] {
            for queue in book.values() {
                if let Some(o) = queue.iter().find(|o| o.id == r.order_id) {
                    return Ok(Response::new(proto::GetOrderResponse { order: Some(order_to_proto(o)) }));
                }
            }
        }
        Err(Status::not_found("order not found"))
    }

    async fn get_order_book(
        &self,
        req: Request<proto::GetOrderBookRequest>,
    ) -> Result<Response<proto::GetOrderBookResponse>, Status> {
        let r = req.get_ref();
        let m = self.engine.market(&r.market).ok_or_else(|| Status::not_found("market not found"))?;
        let m = m.lock();
        let depth = if r.depth == 0 { 20 } else { r.depth as usize };
        let (bids, asks) = m.book.snapshot(depth);
        Ok(Response::new(proto::GetOrderBookResponse {
            snapshot: Some(proto::OrderBookSnapshot {
                market: r.market.clone(),
                bids: bids
                    .into_iter()
                    .map(|l| proto::PriceLevel { price: l.price.to_string(), quantity: l.quantity.to_string(), order_count: l.order_count })
                    .collect(),
                asks: asks
                    .into_iter()
                    .map(|l| proto::PriceLevel { price: l.price.to_string(), quantity: l.quantity.to_string(), order_count: l.order_count })
                    .collect(),
                sequence: m.book.sequence,
                as_of: Some(prost_types::Timestamp {
                    seconds: chrono::Utc::now().timestamp(),
                    nanos: 0,
                }),
            }),
        }))
    }

    type StreamOrderBookStream = tokio_stream::wrappers::ReceiverStream<Result<proto::OrderBookSnapshot, Status>>;

    async fn stream_order_book(
        &self,
        _req: Request<proto::StreamOrderBookRequest>,
    ) -> Result<Response<Self::StreamOrderBookStream>, Status> {
        let (tx, rx) = tokio::sync::mpsc::channel(16);
        // Placeholder: would subscribe to internal broadcaster.
        drop(tx);
        Ok(Response::new(tokio_stream::wrappers::ReceiverStream::new(rx)))
    }

    type StreamTradesStream = tokio_stream::wrappers::ReceiverStream<Result<proto::Trade, Status>>;

    async fn stream_trades(
        &self,
        _req: Request<proto::StreamTradesRequest>,
    ) -> Result<Response<Self::StreamTradesStream>, Status> {
        let (tx, rx) = tokio::sync::mpsc::channel(16);
        drop(tx);
        Ok(Response::new(tokio_stream::wrappers::ReceiverStream::new(rx)))
    }
}
