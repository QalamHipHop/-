FROM rust:1.85-slim AS build
WORKDIR /app
# Sandbox-safe compilation: avoid exhausting the Docker daemon memory budget.
ENV CARGO_BUILD_JOBS=2
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev ca-certificates protobuf-compiler libprotobuf-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml ./
COPY build.rs ./
COPY proto ./proto
RUN mkdir src && \
    echo "pub mod _dummy { pub fn x() {} }" > src/lib.rs && \
    echo "fn main(){}" > src/main.rs && \
    cargo build --release --jobs ${CARGO_BUILD_JOBS} && \
    rm -rf src
COPY src ./src
# Docker preserves source mtimes; refresh them so Cargo never reuses the dummy binary.
RUN find src -type f -exec touch {} + && cargo build --release --jobs ${CARGO_BUILD_JOBS}

FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/release/matching-engine /usr/local/bin/matching-engine
EXPOSE 50051 8081 9101
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:8081/healthz || exit 1
ENV MATCHING_GRPC_ADDR=0.0.0.0:50051 \
    MATCHING_HEALTH_ADDR=0.0.0.0:8081 \
    MATCHING_METRICS_ADDR=0.0.0.0:9101 \
    RUST_LOG=info,matching_engine=info
ENTRYPOINT ["/usr/local/bin/matching-engine"]
