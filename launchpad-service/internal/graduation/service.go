// Package graduation — periodic sweep that graduates tokens whose reserve
// has reached the configured threshold.  Posts the request to the AMM
// adapter (Raydium clone / Uniswap clone) and marks the token as `graduated`.
package graduation

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"github.com/rial/launchpad-service/internal/config"
	"github.com/rial/launchpad-service/internal/curve"
	"github.com/rial/launchpad-service/internal/event"
	"github.com/rial/launchpad-service/internal/store"
)

type Service struct {
	cfg   *config.Config
	pg    *store.PG
	rd    *store.RD
	nc    *event.Nats
	curve *curve.Engine
	amm   AMMAdapter
	log   *zap.Logger

	mu       sync.Mutex
	notifyCh chan uuid.UUID
}

func NewService(cfg *config.Config, c *curve.Engine, pg *store.PG, rd *store.RD, nc *event.Nats, amm AMMAdapter, log *zap.Logger) *Service {
	return &Service{cfg: cfg, pg: pg, rd: rd, nc: nc, curve: c, amm: amm, log: log, notifyCh: make(chan uuid.UUID, 256)}
}

func (s *Service) Notify(ctx context.Context, tokenID uuid.UUID) {
	select {
	case s.notifyCh <- tokenID:
	default:
		// queue full — periodic sweeper will catch up
	}
}

func (s *Service) Run(ctx context.Context, period time.Duration) {
	t := time.NewTicker(period)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.tick(ctx)
		case id := <-s.notifyCh:
			s.graduate(ctx, id)
		}
	}
}

func (s *Service) tick(ctx context.Context) {
	rows, err := s.pg.Pool.Query(ctx, `SELECT id FROM launchpad.tokens WHERE graduated = false AND status = 'live'`)
	if err != nil {
		s.log.Warn("graduation query", zap.Error(err))
		return
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	for _, id := range ids {
		bs, err := s.pg.GetBonding(ctx, id)
		if err != nil {
			continue
		}
		tk, err := s.pg.GetToken(ctx, id)
		if err != nil {
			continue
		}
		if bs.ReserveRialMinor+bs.VirtualRialMinor >= tk.GraduationRialMinor {
			s.graduate(ctx, id)
		}
	}
}

func (s *Service) graduate(ctx context.Context, id uuid.UUID) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.amm == nil {
		s.log.Warn("graduation blocked: AMM adapter is not configured", zap.String("id", id.String()))
		return
	}
	tk, err := s.pg.GetToken(ctx, id)
	if err != nil {
		s.log.Warn("graduation token lookup", zap.Error(err))
		return
	}
	bs, err := s.pg.GetBonding(ctx, id)
	if err != nil {
		s.log.Warn("graduation bonding lookup", zap.Error(err))
		return
	}
	pool, err := s.amm.CreatePool(ctx, PoolRequest{
		TokenID: id, Base: s.cfg.Launchpad.AMMBase,
		ReserveRialMinor: bs.ReserveRialMinor, SupplyMinor: bs.SupplyCirculatingMinor,
		IdempotencyKey: "graduation:" + id.String(),
	})
	if err != nil {
		s.log.Warn("graduation AMM submission failed", zap.String("id", id.String()), zap.Error(err))
		return
	}
	// Run in a transaction; only a confirmed AMM response can finalize the token.
	err = s.pg.WithTx(ctx, func(tx pgx.Tx) error {
		var graduated bool
		if err := tx.QueryRow(ctx, `SELECT graduated FROM launchpad.tokens WHERE id=$1 FOR UPDATE`, id).Scan(&graduated); err != nil {
			return err
		}
		if graduated {
			return nil
		}
		if _, err := tx.Exec(ctx, `UPDATE launchpad.tokens SET graduated=true, graduated_at=now(), status='graduated', updated_at=now() WHERE id=$1`, id); err != nil {
			return err
		}
		payload := map[string]any{
			"token_id":     id.String(),
			"adapter":      s.cfg.Launchpad.AMMAdapter,
			"base":         s.cfg.Launchpad.AMMBase,
			"pool_address": pool.PoolAddress,
			"tx_hash":      pool.TxHash,
		}
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		hash := sha256.Sum256(raw)
		_, err = tx.Exec(ctx, `
			INSERT INTO shared.outbox (aggregate, aggregate_id, event_type, payload, payload_hash, source_service)
			VALUES ('launchpad', $1, 'launchpad.graduated', $2::jsonb, $3, 'launchpad')
			ON CONFLICT (aggregate, aggregate_id, event_type) DO NOTHING`,
			id.String(), raw, hash[:])
		return err
	})
	if err != nil {
		s.log.Warn("graduate tx", zap.String("id", id.String()), zap.Error(err))
		return
	}

	// Publication is owned by the durable launchpad outbox relay.
	s.log.Info("token graduated after AMM confirmation", zap.String("id", id.String()), zap.String("pool", pool.PoolAddress), zap.String("tx_hash", pool.TxHash), zap.String("token", tk.Symbol))
}
