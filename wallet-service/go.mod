module github.com/rial/wallet-service

go 1.22

require (
	github.com/gin-gonic/gin v1.10.0
	github.com/jackc/pgx/v5 v5.5.5
	github.com/redis/go-redis/v9 v9.5.1
	github.com/nats-io/nats.go v1.32.0
	github.com/segmentio/kafka-go v0.4.47
	google.golang.org/grpc v1.64.0
	google.golang.org/protobuf v1.34.1
	github.com/ethereum/go-ethereum v1.14.5
	github.com/btcsuite/btcd/btcec/v2 v2.3.2
	github.com/shopspring/decimal v1.4.0
	github.com/google/uuid v1.6.0
	github.com/rs/zerolog v1.33.0
	github.com/spf13/viper v1.19.0
	github.com/prometheus/client_golang v1.19.1
	github.com/stretchr/testify v1.9.0
	go.opentelemetry.io/otel v1.27.0
	go.opentelemetry.io/otel/sdk v1.27.0
	go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc v1.27.0
)
