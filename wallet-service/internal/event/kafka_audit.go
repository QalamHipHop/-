package event

import (
	"context"
	"time"

	"github.com/segmentio/kafka-go"

	"github.com/rial/wallet-service/internal/config"
)

type KafkaAudit struct {
	w *kafka.Writer
}

func NewKafkaAudit(ctx context.Context, cfg config.KafkaConfig) (*KafkaAudit, error) {
	w := &kafka.Writer{
		Addr: kafka.TCP(cfg.Brokers...),
		Topic: cfg.AuditTopic,
		Balancer: &kafka.Hash{},
		RequiredAcks: kafka.RequireAll,
		Async: false,
		BatchTimeout: 50 * time.Millisecond,
	}
	return &KafkaAudit{w: w}, nil
}

func (k *KafkaAudit) Emit(ctx context.Context, key string, value []byte) error {
	return k.w.WriteMessages(ctx, kafka.Message{Key: []byte(key), Value: value})
}

func (k *KafkaAudit) Close() { _ = k.w.Close() }
