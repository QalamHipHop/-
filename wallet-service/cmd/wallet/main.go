// Package main is the entrypoint for the RIAL wallet-service.
//
// Architecture: per ADR-0001, this service owns the `wallet` schema in
// Postgres and emits domain events to NATS JetStream, with a Kafka audit
// mirror (ADR-0008). All monetary values are bigint minor units (8 dp).
package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/rial/wallet-service/internal/api"
	"github.com/rial/wallet-service/internal/config"
	"github.com/rial/wallet-service/internal/custody"
	"github.com/rial/wallet-service/internal/event"
	"github.com/rial/wallet-service/internal/grpc"
	"github.com/rial/wallet-service/internal/ledger"
	"github.com/rial/wallet-service/internal/middleware"
	"github.com/rial/wallet-service/internal/store"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.24.0"
)

func main() {
	zerolog.TimeFieldFormat = time.RFC3339Nano
	log.Logger = log.Output(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339})

	cfg, err := config.Load()
	if err != nil {
		log.Fatal().Err(err).Msg("config load failed")
	}

	rootCtx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// --- Tracing ---
	if cfg.OTELEndpoint != "" {
		exporter, err := otlptracegrpc.New(rootCtx,
			otlptracegrpc.WithEndpoint(cfg.OTELEndpoint),
			otlptracegrpc.WithInsecure(),
		)
		if err != nil {
			log.Warn().Err(err).Msg("otel exporter init failed")
		} else {
			tp := sdktrace.NewTracerProvider(
				sdktrace.WithBatcher(exporter),
				sdktrace.WithResource(resource.NewWithAttributes(
					semconv.SchemaURL,
					semconv.ServiceName("rial-wallet-service"),
					semconv.ServiceVersion(cfg.AppVersion),
					semconv.DeploymentEnvironment(cfg.Env),
				)),
			)
			otel.SetTracerProvider(tp)
			defer func() { _ = tp.Shutdown(context.Background()) }()
		}
	}

	// --- Stores ---
	pg, err := store.NewPostgres(rootCtx, cfg.Postgres)
	if err != nil {
		log.Fatal().Err(err).Msg("postgres connect failed")
	}
	defer pg.Close()

	rds, err := store.NewRedis(rootCtx, cfg.Redis)
	if err != nil {
		log.Fatal().Err(err).Msg("redis connect failed")
	}
	defer rds.Close()

	// --- Eventing ---
	publisher, err := event.NewNATS(rootCtx, cfg.NATS)
	if err != nil {
		log.Fatal().Err(err).Msg("nats connect failed")
	}
	defer publisher.Close()

	audit, err := event.NewKafkaAudit(rootCtx, cfg.Kafka)
	if err != nil {
		log.Fatal().Err(err).Msg("kafka producer failed")
	}
	defer audit.Close()

	// --- Custody (HSM abstraction) ---
	cust := custody.New(cfg.Custody)

	// --- Ledger service ---
	ledgerSvc := ledger.NewService(pg, rds, publisher, audit, cust, cfg.Settlement)

	// --- HTTP server ---
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.Use(middleware.Recovery(log.Logger), middleware.CorrelationID(), middleware.AccessLog(), middleware.Metrics())
	r.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	r.GET("/readyz", func(c *gin.Context) {
		ctx, cc := context.WithTimeout(c.Request.Context(), 3*time.Second)
		defer cc()
		if err := pg.Ping(ctx); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "down", "err": err.Error()})
			return
		}
		if err := rds.Ping(ctx).Err(); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "down", "err": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ready"})
	})
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))

	api.RegisterRoutes(r, ledgerSvc, cfg)

	// --- gRPC server (internal) ---
	grpcSrv := grpc.NewServer(ledgerSvc, cfg)
	go func() {
		if err := grpcSrv.Start(cfg.GRPCAddr); err != nil {
			log.Error().Err(err).Msg("grpc server stopped")
		}
	}()

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		log.Info().Str("addr", cfg.HTTPAddr).Msg("wallet-service listening")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatal().Err(err).Msg("http server failed")
		}
	}()

	// --- Graceful shutdown ---
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	log.Info().Msg("shutdown initiated")
	shutdownCtx, sc := context.WithTimeout(context.Background(), 15*time.Second)
	defer sc()
	_ = srv.Shutdown(shutdownCtx)
	grpcSrv.GracefulStop()
	log.Info().Msg("shutdown complete")
}
