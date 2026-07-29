//! Integration smoke tests for the trading engine.

use rust_decimal_macros::dec;
use trading_engine::router::{Router, RouterConfig};
use trading_engine::strategy::{MarketMakingConfig, StrategyEngine, StrategyKind, StrategySpec};
use trading_engine::types::{OrderRequest, OrderType, Side, TimeInForce};

#[test]
fn route_market_order_internal_only() {
    let router = Router::new(RouterConfig::default());
    let req = OrderRequest {
        client_order_id: "c-1".into(),
        user_id: "u-1".into(),
        symbol: "RIAL/USDT".into(),
        side: Side::Buy,
        order_type: OrderType::Market,
        tif: TimeInForce::Ioc,
        quantity: dec!(10),
        price: Some(dec!(100)),
        venue_hint: None,
        allow_external: false,
        correlation_id: "corr-1".into(),
    };
    let res = router.route(&req);
    assert_eq!(res.status, trading_engine::types::RouteStatus::Accepted);
    assert_eq!(res.legs.len(), 1);
    assert_eq!(res.legs[0].venue, "internal:matching");
}

#[test]
fn route_rejects_zero_quantity() {
    let router = Router::new(RouterConfig::default());
    let req = OrderRequest {
        client_order_id: "c-1".into(),
        user_id: "u-1".into(),
        symbol: "RIAL/USDT".into(),
        side: Side::Buy,
        order_type: OrderType::Market,
        tif: TimeInForce::Ioc,
        quantity: dec!(0),
        price: Some(dec!(100)),
        venue_hint: None,
        allow_external: false,
        correlation_id: "corr-1".into(),
    };
    let res = router.route(&req);
    assert_eq!(res.status, trading_engine::types::RouteStatus::Rejected);
    assert!(res.reason.is_some());
}

#[test]
fn route_rejects_excessive_notional() {
    let cfg = RouterConfig {
        max_order_notional: dec!(100),
        ..Default::default()
    };
    let router = Router::new(cfg);
    let req = OrderRequest {
        client_order_id: "c-1".into(),
        user_id: "u-1".into(),
        symbol: "RIAL/USDT".into(),
        side: Side::Buy,
        order_type: OrderType::Limit,
        tif: TimeInForce::Gtc,
        quantity: dec!(10),
        price: Some(dec!(100)),
        venue_hint: None,
        allow_external: false,
        correlation_id: "corr-1".into(),
    };
    let res = router.route(&req);
    assert_eq!(res.status, trading_engine::types::RouteStatus::Rejected);
}

#[test]
fn strategy_engine_emits_quotes_after_reference() {
    let eng = StrategyEngine::new(MarketMakingConfig::default());
    eng.set_reference("RIAL/USDT", dec!(99), dec!(101));
    let mut s = StrategySpec::new(StrategyKind::PeggedQuotes, "RIAL/USDT");
    s.id = "s-1".into();
    eng.upsert(s).unwrap();
    let quotes = eng.tick();
    assert_eq!(quotes.len(), 2);
    let bid = quotes.iter().find(|q| q.side == Side::Buy).unwrap();
    let ask = quotes.iter().find(|q| q.side == Side::Sell).unwrap();
    assert!(bid.price < ask.price);
}
