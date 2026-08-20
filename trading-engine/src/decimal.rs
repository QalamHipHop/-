//! Small helpers for `rust_decimal::Decimal` arithmetic commonly used
//! in trading math (basis-point spreads, notional, etc.).

use rust_decimal::Decimal;
use std::str::FromStr;

pub fn decimal_from_str(s: &str) -> Result<Decimal, String> {
    Decimal::from_str(s.trim()).map_err(|e| format!("invalid decimal '{s}': {e}"))
}

/// `bps` is a percentage expressed in 1/10000 units.
/// e.g. 30 bps = 0.30 %.
pub fn apply_bps(price: Decimal, bps: i64) -> Decimal {
    // price * (1 + bps/10_000)
    let factor = Decimal::from(10_000 + bps) / Decimal::from(10_000);
    (price * factor).round_dp(8)
}

pub fn apply_bps_down(price: Decimal, bps: i64) -> Decimal {
    let factor = Decimal::from(10_000 - bps) / Decimal::from(10_000);
    (price * factor).round_dp(8)
}

pub fn notional(price: Decimal, qty: Decimal) -> Decimal {
    (price * qty).round_dp(8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bps_up_30() {
        let p = Decimal::from(100);
        // +0.30% = 100.30
        assert_eq!(apply_bps(p, 30), Decimal::from_str("100.30000000").unwrap());
    }

    #[test]
    fn bps_down_30() {
        let p = Decimal::from(100);
        // -0.30% = 99.70
        assert_eq!(
            apply_bps_down(p, 30),
            Decimal::from_str("99.70000000").unwrap()
        );
    }

    #[test]
    fn notional_basic() {
        let p = Decimal::from(2);
        let q = Decimal::from(3);
        assert_eq!(notional(p, q), Decimal::from(6));
    }
}
