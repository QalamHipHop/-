// Package event — Kafka audit log writer.
package event

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/segmentio/kafka-go"
	"go.uber.org/zap"
)

type Kafka struct {
	w     *kafka.Writer
	mu    sync.Mutex
	log   *zap.Logger
	topic string
}

func NewKafkaProducer(brokers []string, log *zap.Logger) (*Kafka, error) {
	if len(brokers) == 0 { return nil, nil }
	w := &kafka.Writer{
		Addr:         kafka.TCP(brokers...),
		Topic:        "rial.launchpad",
		Balancer:     &kafka.Hash{},
		RequiredAcks: kafka.RequireAll,
		BatchTimeout: 50 * time.Millisecond,
	}
	log.Info("kafka producer ready", zap.Strings("brokers", brokers))
	return &Kafka{w: w, log: log, topic: "rial.launchpad"}, nil
}

func (k *Kafka) Close() error { if k == nil || k.w == nil { return nil }; return k.w.Close() }

func (k *Kafka) Audit(ctx context.Context, key string, payload interface{}) {
	if k == nil || k.w == nil { return }
	body, err := json.Marshal(payload)
	if err != nil { k.log.Warn("marshal audit", zap.Error(err)); return }
	msg := kafka.Message{Key: []byte(key), Value: body, Time: time.Now()}
	k.mu.Lock()
	defer k.mu.Unlock()
	if err := k.w.WriteMessages(ctx, msg); err != nil {
		k.log.Warn("kafka write", zap.Error(err))
	}
}
