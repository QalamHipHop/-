//! Trading engine library — exposes modules used by `main.rs` and
//! the integration test suite.

pub mod config;
pub mod decimal;
pub mod health;
pub mod metrics;
pub mod proto;
pub mod router;
pub mod service;
pub mod strategy;
pub mod types;

pub use proto::rial::trading::v1 as pb;
