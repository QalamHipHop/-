use matching_engine::{Engine, Order, Side, TimeInForce};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;

fn limit(market: &str, user: &str, side: Side, price: i64, qty: i64) -> Order {
    Order::new_limit(
        market,
        user,
        side,
        Decimal::from(price),
        Decimal::from(qty),
        TimeInForce::Gtc,
    )
}

#[test]
fn limit_orders_match_price_time_priority() {
    let engine = Engine::new(Default::default());
    let r1 = engine.submit(limit("RIAL-USD", "alice", Side::Sell, 100, 10));
    let r2 = engine.submit(limit("RIAL-USD", "bob", Side::Buy, 100, 5));

    assert_eq!(r1.trades.len(), 0, "resting sell, no fill");
    assert_eq!(r2.trades.len(), 1);
    assert_eq!(r2.trades[0].quantity, dec!(5));
    assert_eq!(r2.trades[0].price, dec!(100));
    assert!(r2.fully_filled);
}

#[test]
fn resting_order_partially_fills_next_taker() {
    let engine = Engine::new(Default::default());
    engine.submit(limit("RIAL-USD", "alice", Side::Sell, 100, 10));
    let r = engine.submit(limit("RIAL-USD", "bob", Side::Buy, 100, 7));

    assert_eq!(r.trades.len(), 1);
    assert_eq!(r.trades[0].quantity, dec!(7));
    // remaining 3 in book
    let m = engine.market("RIAL-USD").unwrap();
    let m = m.lock();
    assert_eq!(m.book.asks.get(&dec!(100)).unwrap().len(), 1);
    let remaining: rust_decimal::Decimal = m
        .book
        .asks
        .get(&dec!(100))
        .unwrap()
        .iter()
        .map(|o| o.remaining_quantity)
        .sum();
    assert_eq!(remaining, dec!(3));
}

#[test]
fn ioc_does_not_rest() {
    let engine = Engine::new(Default::default());
    let r = engine.submit({
        let mut o = limit("RIAL-USD", "alice", Side::Buy, 100, 5);
        o.tif = TimeInForce::Ioc;
        o
    });
    assert_eq!(r.trades.len(), 0);
    assert!(!r.fully_filled);
    let m = engine.market("RIAL-USD").unwrap();
    let m = m.lock();
    assert!(m.book.bids.is_empty());
}

#[test]
fn fok_rejects_when_not_fully_fillable() {
    let engine = Engine::new(Default::default());
    engine.submit(limit("RIAL-USD", "alice", Side::Sell, 100, 3));
    let r = engine.submit({
        let mut o = limit("RIAL-USD", "bob", Side::Buy, 100, 5);
        o.tif = TimeInForce::Fok;
        o
    });
    assert!(r.trades.is_empty());
    // book untouched
    let m = engine.market("RIAL-USD").unwrap();
    let m = m.lock();
    let total: rust_decimal::Decimal = m
        .book
        .asks
        .get(&dec!(100))
        .unwrap()
        .iter()
        .map(|o| o.remaining_quantity)
        .sum();
    assert_eq!(total, dec!(3));
}

#[test]
fn market_order_sweeps_multiple_levels() {
    let engine = Engine::new(Default::default());
    engine.submit(limit("RIAL-USD", "a", Side::Sell, 100, 2));
    engine.submit(limit("RIAL-USD", "b", Side::Sell, 101, 3));
    engine.submit(limit("RIAL-USD", "c", Side::Sell, 102, 5));

    let r = engine.submit(Order::new_market("RIAL-USD", "buyer", Side::Buy, dec!(7)));
    assert_eq!(r.trades.len(), 3);
    assert_eq!(r.trades[0].price, dec!(100));
    assert_eq!(r.trades[1].price, dec!(101));
    assert_eq!(r.trades[2].price, dec!(102));
    assert_eq!(
        r.trades
            .iter()
            .map(|t| t.quantity)
            .sum::<rust_decimal::Decimal>(),
        dec!(7)
    );
}

#[test]
fn cancel_removes_resting_order() {
    let engine = Engine::new(Default::default());
    let r = engine.submit(limit("RIAL-USD", "alice", Side::Buy, 100, 5));
    let canceled = engine.cancel("RIAL-USD", &r.order.id);
    assert!(canceled.is_some());
    let m = engine.market("RIAL-USD").unwrap();
    let m = m.lock();
    assert!(m.book.bids.is_empty());
}

#[test]
fn cancel_all_per_user() {
    let engine = Engine::new(Default::default());
    engine.submit(limit("M1", "u1", Side::Buy, 100, 1));
    engine.submit(limit("M2", "u1", Side::Buy, 200, 1));
    engine.submit(limit("M1", "u2", Side::Buy, 100, 1));

    let canceled = engine.cancel_all("u1", None);
    assert_eq!(canceled.len(), 2);
}

#[test]
fn fees_applied_to_trade() {
    let engine = Engine::new(Default::default());
    engine.submit(limit("RIAL-USD", "alice", Side::Sell, 100, 10));
    let r = engine.submit(limit("RIAL-USD", "bob", Side::Buy, 100, 10));
    assert_eq!(r.trades.len(), 1);
    // 30 bps taker on 1000 = 3.0; maker 10 bps = 1.0
    assert_eq!(r.trades[0].taker_fee, dec!(3));
    assert_eq!(r.trades[0].maker_fee, dec!(1));
}

#[test]
fn bid_ask_priority_correct() {
    let engine = Engine::new(Default::default());
    engine.submit(limit("M", "a", Side::Sell, 104, 1));
    engine.submit(limit("M", "b", Side::Sell, 103, 1));
    engine.submit(limit("M", "c", Side::Buy, 101, 1));
    engine.submit(limit("M", "d", Side::Buy, 102, 1));

    let m = engine.market("M").unwrap();
    let m = m.lock();
    let (bids, asks) = m.book.snapshot(10);
    // best bid = highest, best ask = lowest
    assert_eq!(bids[0].price, dec!(102));
    assert_eq!(asks[0].price, dec!(103));
}

#[test]
fn price_time_priority_within_same_level() {
    let engine = Engine::new(Default::default());
    engine.submit(limit("M", "a", Side::Sell, 100, 1));
    engine.submit(limit("M", "b", Side::Sell, 100, 1));
    let r = engine.submit(limit("M", "buyer", Side::Buy, 100, 1));
    assert_eq!(r.trades[0].seller_order_id, r.trades[0].seller_order_id); // sanity
    let m = engine.market("M").unwrap();
    let m = m.lock();
    let q = m.book.asks.get(&dec!(100)).unwrap();
    assert_eq!(q.front().unwrap().user_id, "b");
}
