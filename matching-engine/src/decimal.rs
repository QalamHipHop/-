//! Decimal helpers — use rust_decimal with explicit precision and rounding.

use rust_decimal::Decimal;
use std::str::FromStr;

pub type Amount = Decimal;

#[allow(dead_code)]
pub const SCALE: u32 = 18;

pub fn dec(value: &str) -> Amount {
    Decimal::from_str(value).expect("invalid decimal literal")
}

pub fn zero() -> Amount {
    Amount::ZERO
}

pub fn is_positive(d: Amount) -> bool {
    d > Amount::ZERO
}

pub fn min(a: Amount, b: Amount) -> Amount {
    if a <= b {
        a
    } else {
        b
    }
}
