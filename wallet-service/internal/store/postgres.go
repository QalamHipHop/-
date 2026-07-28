// Package store provides connection helpers.
package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rial/wallet-service/internal/config"
)

type Postgres struct {
	Pool *pgxpool.Pool
}

func NewPostgres(ctx context.Context, cfg config.PostgresConfig) (*Postgres, error) {
	pcfg, err := pgxpool.ParseConfig(cfg.DSN())
	if err != nil { return nil, fmt.Errorf("parse dsn: %w", err) }
	pcfg.MaxConns = int32(cfg.PoolMax)
	pcfg.MinConns = 2
	pcfg.MaxConnLifetime = 30 * time.Minute
	pcfg.MaxConnIdleTime = 5 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, pcfg)
	if err != nil { return nil, fmt.Errorf("create pool: %w", err) }
	pingCtx, cc := context.WithTimeout(ctx, 5*time.Second)
	defer cc()
	if err := pool.Ping(pingCtx); err != nil { return nil, fmt.Errorf("ping: %w", err) }
	return &Postgres{Pool: pool}, nil
}

func (p *Postgres) Close() { p.Pool.Close() }
func (p *Postgres) Ping(ctx context.Context) error {
	pingCtx, cc := context.WithTimeout(ctx, 2*time.Second)
	defer cc()
	return p.Pool.Ping(pingCtx)
}
