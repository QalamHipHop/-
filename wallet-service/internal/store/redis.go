package store

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/rial/wallet-service/internal/config"
)

func NewRedis(ctx context.Context, cfg config.RedisConfig) (*redis.Client, error) {
	cli := redis.NewClient(&redis.Options{
		Addr:     cfg.Addr,
		Password: cfg.Password,
		DB:       cfg.DB,
		TLSConfig: nil,
	})
	if cfg.TLS {
		// tls.Config left to ops; for k8s use cert-manager sidecar
	}
	pingCtx, cc := context.WithTimeout(ctx, 3*time.Second)
	defer cc()
	if err := cli.Ping(pingCtx).Err(); err != nil {
		return nil, err
	}
	return cli, nil
}
