//! Generated protobuf bindings for the trading engine.
//!
//! Re-exported under the `rial::trading::v1` path so that callers can
//! write `crate::proto::rial::trading::v1 as pb` consistently.

#![allow(clippy::all, clippy::pedantic)]

pub mod rial {
    pub mod trading {
        pub mod v1 {
            tonic::include_proto!("rial.trading.v1");
        }
    }
}
