// Package event — NATS publisher with optional graceful no-op.
package event

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/nats-io/nats.go"
	"go.uber.org/zap"
)

type Nats struct {
	conn *nats.Conn
	mu   sync.Mutex
	log  *zap.Logger
}

func NewNats(url string, log *zap.Logger) (*Nats, error) {
	if url == "" { return nil, nil }
	conn, err := nats.Connect(url, nats.MaxReconnects(-1), nats.ReconnectWait(2*time.Second), nats.Timeout(5*time.Second))
	if err != nil { return nil, err }
	log.Info("nats connected", zap.String("url", url))
	return &Nats{conn: conn, log: log}, nil
}

func (n *Nats) Close() {
	if n == nil || n.conn == nil { return }
	n.conn.Close()
}

func (n *Nats) Publish(ctx context.Context, subject string, payload interface{}) {
	if n == nil || n.conn == nil { return }
	body, err := json.Marshal(payload)
	if err != nil { n.log.Warn("marshal", zap.Error(err)); return }
	n.mu.Lock()
	defer n.mu.Unlock()
	if err := n.conn.Publish(subject, body); err != nil {
		n.log.Warn("publish", zap.String("subject", subject), zap.Error(err))
		return
	}
	if err := n.conn.FlushTimeout(500 * time.Millisecond); err != nil {
		n.log.Warn("flush", zap.Error(err))
	}
}

func (n *Nats) Subscribe(subject string, handler func(ctx context.Context, msgID string, data []byte) error) {
	if n == nil || n.conn == nil { return }
	if _, err := n.conn.Subscribe(subject, func(m *nats.Msg) {
		if err := handler(context.Background(), uuid.NewString(), m.Data); err != nil {
			n.log.Warn("handler", zap.String("subject", subject), zap.Error(err))
		}
	}); err != nil {
		n.log.Warn("subscribe", zap.String("subject", subject), zap.Error(err))
	}
}
