// Generated proto bindings (built by build.rs).
#![allow(clippy::all)]
pub mod rial {
    pub mod matching {
        pub mod v1 {
            tonic::include_proto!("rial.matching.v1");
            pub const FILE_DESCRIPTOR_SET: &[u8] =
                tonic::include_file_descriptor_set!("matching_descriptor");
        }
    }
}

pub use rial::matching::v1::*;
pub use rial::matching::v1::matching_engine_server::{MatchingEngine, MatchingEngineServer};
