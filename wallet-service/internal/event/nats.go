// Package event wires NATS JetStream publisher and Kafka audit sink.
package event

import (
	"context"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/rs/zerolog/log"

	"github.com/rial/wallet-service/internal/config"
)

type NATSPublisher struct {
	nc     *nats.Conn
	js     nats.JetStreamContext
	stream string
}

func NewNATS(ctx context.Context, cfg config.NATSConfig) (*NATSPublisher, error) {
	opts := []nats.Option{nats.Name("rial-wallet-service"), nats.MaxReconnects(-1), nats.ReconnectWait(2 * time.Second)}
	if cfg.Token != "" {
		opts = append(opts, nats.Token(cfg.Token))
	}
	if cfg.User != "" {
		opts = append(opts, nats.UserInfo(cfg.User, cfg.Pass))
	}
	nc, err := nats.Connect(cfg.Servers[0], opts...)
	if err != nil {
		return nil, err
	}
	js, err := nc.JetStream()
	if err != nil {
		return nil, err
	}
	// Ensure the shared event stream covers every durable subject family.
	streamSubjects := []string{"rial.>", "trading.>", "launchpad.>", "payment.>", "wallet.>"}
	streamCfg := &nats.StreamConfig{
		Name: cfg.Stream, Subjects: streamSubjects, Retention: nats.LimitsPolicy, MaxAge: 7 * 24 * time.Hour,
		Storage: nats.FileStorage, Replicas: 1,
	}
	if _, err = js.AddStream(streamCfg); err == nats.ErrStreamNameAlreadyInUse {
		info, infoErr := js.StreamInfo(cfg.Stream)
		if infoErr != nil {
			nc.Close()
			return nil, infoErr
		}
		info.Config.Subjects = streamSubjects
		if _, updateErr := js.UpdateStream(&info.Config); updateErr != nil {
			nc.Close()
			return nil, updateErr
		}
	} else if err != nil {
		nc.Close()
		return nil, err
	}
	return &NATSPublisher{nc: nc, js: js, stream: cfg.Stream}, nil
}

func (p *NATSPublisher) Publish(ctx context.Context, subject string, body []byte) error {
	if _, err := p.js.PublishAsync(subject, body); err != nil {
		return err
	}
	return nil
}

func (p *NATSPublisher) PublishDurable(ctx context.Context, subject, messageID string, body []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	msg := nats.NewMsg(subject)
	msg.Header.Set("Nats-Msg-Id", messageID)
	msg.Data = body
	_, err := p.js.PublishMsg(msg)
	return err
}

func (p *NATSPublisher) Close() {
	if p.nc != nil {
		p.nc.Drain()
	}
}

// helper
func (p *NATSPublisher) LogPublishErr(subject string, err error) {
	log.Warn().Err(err).Str("subject", subject).Msg("publish failed")
}
