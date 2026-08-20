package event

import (
	"context"
	"encoding/json"
	"math"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog/log"
)

type outboxRow struct {
	ID       string
	Type     string
	Payload  []byte
	Attempts int
}

type OutboxRelay struct {
	pool      *pgxpool.Pool
	publisher *NATSPublisher
	stop      chan struct{}
	wg        sync.WaitGroup
}

func NewOutboxRelay(pool *pgxpool.Pool, publisher *NATSPublisher) *OutboxRelay {
	return &OutboxRelay{pool: pool, publisher: publisher, stop: make(chan struct{})}
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
		log.Warn().Err(err).Msg("wallet outbox claim failed")
		return
	}
	for _, row := range rows {
		if err := r.publisher.PublishDurable(ctx, row.Type, row.ID, row.Payload); err != nil {
			r.fail(ctx, row.ID, row.Attempts+1, err.Error())
			log.Warn().Err(err).Str("outbox_id", row.ID).Msg("wallet outbox publish failed")
			continue
		}
		if _, err := r.pool.Exec(ctx, `UPDATE shared.outbox SET published_at=now(), locked_until=NULL, last_error=NULL WHERE id=$1 AND source_service='wallet'`, row.ID); err != nil {
			log.Error().Err(err).Str("outbox_id", row.ID).Msg("wallet outbox mark published failed")
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
		 WHERE source_service='wallet' AND published_at IS NULL
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
		if err := rows.Scan(&row.ID, &row.Type, &payload, &row.Attempts); err != nil {
			return nil, err
		}
		switch value := payload.(type) {
		case []byte:
			row.Payload = value
		case string:
			row.Payload = []byte(value)
		default:
			row.Payload, err = json.Marshal(value)
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
	_, err := r.pool.Exec(ctx, `UPDATE shared.outbox
		SET attempts=$2, last_error=left($3,2000), next_attempt_at=now()+($4*interval '1 second'), locked_until=NULL
		WHERE id=$1 AND source_service='wallet' AND published_at IS NULL`, id, attempts, message, int(delay))
	if err != nil {
		log.Error().Err(err).Str("outbox_id", id).Msg("wallet outbox retry update failed")
	}
}
