// Package config loads typed configuration from env / viper.
package config

import (
	"fmt"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	AppVersion  string
	Env         string
	HTTPAddr    string
	GRPCAddr    string
	OTELEndpoint string

	Postgres PostgresConfig
	Redis    RedisConfig
	NATS     NATSConfig
	Kafka    KafkaConfig
	Custody  CustodyConfig
	Settlement SettlementConfig
}

type PostgresConfig struct {
	Host     string
	Port     int
	DB       string
	User     string
	Password string
	Schema   string
	PoolMax  int
	SSL      bool
	StmtTimeout time.Duration
}

func (p PostgresConfig) DSN() string {
	ssl := "disable"
	if p.SSL { ssl = "require" }
	return fmt.Sprintf("postgres://%s:%s@%s:%d/%s?sslmode=%s&search_path=%s,shared&statement_timeout=%d&application_name=rial-wallet-service",
		p.User, p.Password, p.Host, p.Port, p.DB, ssl, p.Schema, p.StmtTimeout.Milliseconds())
}

type RedisConfig struct {
	Addr     string
	Password string
	DB       int
	Prefix   string
	TLS      bool
}

type NATSConfig struct {
	Servers []string
	Stream  string
	Token   string
	User    string
	Pass    string
}

type KafkaConfig struct {
	Brokers    []string
	AuditTopic string
}

type CustodyConfig struct {
	Mode           string // "memory" | "vault" | "aws-kms" | "gcp-kms"
	VaultAddr      string
	VaultToken     string
	AWSRegion      string
	AWSKeyID       string
	HotWalletLimit string // decimal string in RIAL
}

type SettlementConfig struct {
	Symbol         string
	Decimals       int
	ReserveAccount string
	TreasuryAccount string
}

func Load() (*Config, error) {
	v := viper.New()
	v.SetEnvPrefix("RIAL_WALLET")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()
	setDefaults(v)

	cfg := &Config{
		AppVersion: v.GetString("app_version"),
		Env:        v.GetString("env"),
		HTTPAddr:   v.GetString("http_addr"),
		GRPCAddr:   v.GetString("grpc_addr"),
		OTELEndpoint: v.GetString("otel_endpoint"),
		Postgres: PostgresConfig{
			Host: v.GetString("postgres.host"),
			Port: v.GetInt("postgres.port"),
			DB:   v.GetString("postgres.db"),
			User: v.GetString("postgres.user"),
			Password: v.GetString("postgres.password"),
			Schema: v.GetString("postgres.schema"),
			PoolMax: v.GetInt("postgres.pool_max"),
			SSL: v.GetBool("postgres.ssl"),
			StmtTimeout: time.Duration(v.GetInt("postgres.stmt_timeout_ms")) * time.Millisecond,
		},
		Redis: RedisConfig{
			Addr: v.GetString("redis.addr"),
			Password: v.GetString("redis.password"),
			DB: v.GetInt("redis.db"),
			Prefix: v.GetString("redis.prefix"),
			TLS: v.GetBool("redis.tls"),
		},
		NATS: NATSConfig{
			Servers: splitCsv(v.GetString("nats.servers")),
			Stream: v.GetString("nats.stream"),
			Token: v.GetString("nats.token"),
			User: v.GetString("nats.user"),
			Pass: v.GetString("nats.pass"),
		},
		Kafka: KafkaConfig{
			Brokers: splitCsv(v.GetString("kafka.brokers")),
			AuditTopic: v.GetString("kafka.audit_topic"),
		},
		Custody: CustodyConfig{
			Mode: v.GetString("custody.mode"),
			VaultAddr: v.GetString("custody.vault_addr"),
			VaultToken: v.GetString("custody.vault_token"),
			AWSRegion: v.GetString("custody.aws_region"),
			AWSKeyID: v.GetString("custody.aws_key_id"),
			HotWalletLimit: v.GetString("custody.hot_wallet_limit"),
		},
		Settlement: SettlementConfig{
			Symbol: v.GetString("settlement.symbol"),
			Decimals: v.GetInt("settlement.decimals"),
			ReserveAccount: v.GetString("settlement.reserve_account"),
			TreasuryAccount: v.GetString("settlement.treasury_account"),
		},
	}

	if cfg.Postgres.Password == "" && cfg.Env == "production" {
		return nil, fmt.Errorf("RIAL_WALLET_POSTGRES_PASSWORD is required in production")
	}
	return cfg, nil
}

func setDefaults(v *viper.Viper) {
	v.SetDefault("app_version", "0.1.0")
	v.SetDefault("env", "development")
	v.SetDefault("http_addr", ":8081")
	v.SetDefault("grpc_addr", ":9091")
	v.SetDefault("otel_endpoint", "")

	v.SetDefault("postgres.host", "localhost")
	v.SetDefault("postgres.port", 5432)
	v.SetDefault("postgres.db", "rial")
	v.SetDefault("postgres.user", "rial")
	v.SetDefault("postgres.password", "rial")
	v.SetDefault("postgres.schema", "wallet")
	v.SetDefault("postgres.pool_max", 50)
	v.SetDefault("postgres.ssl", false)
	v.SetDefault("postgres.stmt_timeout_ms", 5000)

	v.SetDefault("redis.addr", "localhost:6379")
	v.SetDefault("redis.password", "")
	v.SetDefault("redis.db", 0)
	v.SetDefault("redis.prefix", "rial:wallet:")
	v.SetDefault("redis.tls", false)

	v.SetDefault("nats.servers", "nats://localhost:4222")
	v.SetDefault("nats.stream", "rial-events")
	v.SetDefault("nats.token", "")
	v.SetDefault("nats.user", "")
	v.SetDefault("nats.pass", "")

	v.SetDefault("kafka.brokers", "localhost:9092")
	v.SetDefault("kafka.audit_topic", "rial.audit")

	v.SetDefault("custody.mode", "memory")
	v.SetDefault("custody.vault_addr", "")
	v.SetDefault("custody.vault_token", "")
	v.SetDefault("custody.aws_region", "")
	v.SetDefault("custody.aws_key_id", "")
	v.SetDefault("custody.hot_wallet_limit", "1000000")

	v.SetDefault("settlement.symbol", "RIAL")
	v.SetDefault("settlement.decimals", 8)
	v.SetDefault("settlement.reserve_account", "reserve")
	v.SetDefault("settlement.treasury_account", "treasury")
}

func splitCsv(s string) []string {
	if s == "" { return nil }
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" { out = append(out, p) }
	}
	return out
}
