package event

import (
	"context"
	"encoding/json"
	"math"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type outboxRow struct {
	id       string
	event    string
	payload  []byte
	attempts int
}

type OutboxRelay struct {
	pool *pgxpool.Pool
	nats *Nats
	log  *zap.Logger
	stop chan struct{}
	wg   sync.WaitGroup
}

func NewOutboxRelay(pool *pgxpool.Pool, nats *Nats, log *zap.Logger) *OutboxRelay {
	return &OutboxRelay{pool: pool, nats: nats, log: log, stop: make(chan struct{})}
}

func (r *OutboxRelay) Start() {
	r.wg.Add(1)
	go func() {
		defer r.wg.Done()
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				r.tick()
			case <-r.stop:
				return
			}
		}
	}()
}

func (r *OutboxRelay) Close() {
	select {
	case <-r.stop:
	default:
		close(r.stop)
	}
	r.wg.Wait()
}

func (r *OutboxRelay) tick() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	rows, err := r.claim(ctx, 100)
	if err != nil {
		r.log.Warn("launchpad outbox claim failed", zap.Error(err))
		return
	}
	for _, row := range rows {
		if err := r.nats.PublishDurable(ctx, row.event, row.id, row.payload); err != nil {
			r.fail(ctx, row.id, row.attempts+1, err.Error())
			r.log.Warn("launchpad outbox publish failed", zap.String("outbox_id", row.id), zap.Error(err))
			continue
		}
		if _, err := r.pool.Exec(ctx, `UPDATE shared.outbox SET published_at=now(), locked_until=NULL, last_error=NULL WHERE id=$1 AND source_service='launchpad'`, row.id); err != nil {
			r.log.Error("launchpad outbox mark published failed", zap.String("outbox_id", row.id), zap.Error(err))
		}
	}
}

func (r *OutboxRelay) claim(ctx context.Context, limit int) ([]outboxRow, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `WITH picked AS (
		SELECT id FROM shared.outbox
		 WHERE source_service='launchpad' AND published_at IS NULL
		   AND (next_attempt_at IS NULL OR next_attempt_at <= now())
		   AND (locked_until IS NULL OR locked_until < now())
		 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1
	)
	UPDATE shared.outbox o SET locked_until=now()+interval '30 seconds'
	FROM picked WHERE o.id=picked.id
	RETURNING o.id, o.event_type, o.payload, o.attempts`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]outboxRow, 0, limit)
	for rows.Next() {
		var row outboxRow
		var payload any
		if err := rows.Scan(&row.id, &row.event, &payload, &row.attempts); err != nil {
			return nil, err
		}
		switch value := payload.(type) {
		case []byte:
			row.payload = value
		case string:
			row.payload = []byte(value)
		default:
			row.payload, err = json.Marshal(value)
			if err != nil {
				return nil, err
			}
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *OutboxRelay) fail(ctx context.Context, id string, attempts int, message string) {
	delay := math.Min(300, math.Max(1, math.Pow(2, math.Min(float64(attempts), 8))))
	if _, err := r.pool.Exec(ctx, `UPDATE shared.outbox SET attempts=$2, last_error=left($3,2000), next_attempt_at=now()+($4*interval '1 second'), locked_until=NULL WHERE id=$1 AND source_service='launchpad' AND published_at IS NULL`, id, attempts, message, int(delay)); err != nil {
		r.log.Error("launchpad outbox retry update failed", zap.String("outbox_id", id), zap.Error(err))
	}
}
