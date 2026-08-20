// Generated proto bindings (built by build.rs).
#![allow(clippy::all)]
pub mod rial {
    pub mod matching {
        #[allow(dead_code)]
        pub mod v1 {
            tonic::include_proto!("rial.matching.v1");
            #[allow(dead_code)]
            pub const FILE_DESCRIPTOR_SET: &[u8] =
                tonic::include_file_descriptor_set!("matching_descriptor");
        }
    }
}

#[allow(unused_imports)]
pub use rial::matching::v1::matching_engine_server::{MatchingEngine, MatchingEngineServer};
pub use rial::matching::v1::*;
