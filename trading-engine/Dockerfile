FROM rust:1.85-slim AS build
WORKDIR /app
# Sandbox-safe compilation: avoid exhausting the Docker daemon memory budget.
ENV CARGO_BUILD_JOBS=2
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev ca-certificates protobuf-compiler libprotobuf-dev && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock* ./
COPY build.rs ./
COPY proto ./proto
RUN mkdir src && echo "fn main(){}" > src/main.rs && \
    cargo build --release --jobs ${CARGO_BUILD_JOBS} && rm -rf src
COPY src ./src
# Docker preserves source mtimes; refresh them so Cargo never reuses the dummy binary.
RUN find src -type f -exec touch {} + && cargo build --release --jobs ${CARGO_BUILD_JOBS}

FROM debian:bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/target/release/trading-engine /usr/local/bin/trading-engine
COPY config/trading.yaml /app/config/trading.yaml
EXPOSE 50052 50082
ENTRYPOINT ["/usr/local/bin/trading-engine"]
