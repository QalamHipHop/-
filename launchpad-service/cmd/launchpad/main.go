// Package main — launchpad-service entrypoint.
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.uber.org/zap"

	"github.com/rial/launchpad-service/internal/api"
	"github.com/rial/launchpad-service/internal/config"
	"github.com/rial/launchpad-service/internal/curve"
	"github.com/rial/launchpad-service/internal/event"
	"github.com/rial/launchpad-service/internal/graduation"
	"github.com/rial/launchpad-service/internal/launch"
	"github.com/rial/launchpad-service/internal/middleware"
	"github.com/rial/launchpad-service/internal/risk"
	"github.com/rial/launchpad-service/internal/store"
)

func main() {
	cfg, err := config.Load()
	if err != nil { panic(err) }
	logger, _ := zap.NewProduction()
	defer func() { _ = logger.Sync() }()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	pg, err := store.NewPostgres(ctx, cfg.Postgres.DSN, logger)
	if err != nil { logger.Fatal("postgres", zap.Error(err)) }
	defer pg.Close()

	rd, err := store.NewRedis(ctx, cfg.Redis.Addr, cfg.Redis.Password, cfg.Redis.DB, logger)
	if err != nil { logger.Fatal("redis", zap.Error(err)) }
	defer rd.Close()

	nc, err := event.NewNats(cfg.Nats.URL, logger)
	if err != nil { logger.Warn("nats disabled", zap.Error(err)); nc = nil }

	kc, err := event.NewKafkaProducer(cfg.Kafka.Brokers, logger)
	if err != nil { logger.Warn("kafka disabled", zap.Error(err)); kc = nil }

	riskClient := risk.NewClient(cfg.AI.EngineURL, logger)
	curveEngine := curve.NewEngine(logger)
	gradSvc := graduation.NewService(cfg, curveEngine, pg, rd, nc, logger)
	launchSvc := launch.NewService(cfg, pg, rd, nc, kc, riskClient, curveEngine, gradSvc, logger)

	srv := api.NewServer(launchSvc, gradSvc, logger)
	httpSrv := &http.Server{
		Addr: ":" + cfg.HTTP.Port,
		Handler: middleware.HTTPTracing(srv.Handler(), logger),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		logger.Info("launchpad http listening", zap.String("port", cfg.HTTP.Port))
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("http serve", zap.Error(err))
		}
	}()
	go gradSvc.Run(ctx, 5*time.Second)

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	logger.Info("shutting down")
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutCancel()
	_ = httpSrv.Shutdown(shutCtx)
}
