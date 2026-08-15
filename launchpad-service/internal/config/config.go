// Package config centralizes service configuration via env vars.
package config

import (
	"errors"
	"strings"
	"time"

	"github.com/spf13/viper"
)

type Config struct {
	Env       string `mapstructure:"env"`
	Service   string `mapstructure:"service"`
	GRPC      GRPC   `mapstructure:"grpc"`
	HTTP      HTTP   `mapstructure:"http"`
	Postgres  PG     `mapstructure:"postgres"`
	Redis     RD     `mapstructure:"redis"`
	Nats      NATS   `mapstructure:"nats"`
	Kafka     KFK    `mapstructure:"kafka"`
	JWT       JWT    `mapstructure:"jwt"`
	AI        AI     `mapstructure:"ai"`
	Wallet    Wallet `mapstructure:"wallet"`
	Launchpad LPD    `mapstructure:"launchpad"`
}

type GRPC struct {
	Port string `mapstructure:"port"`
}
type HTTP struct {
	Port string `mapstructure:"port"`
}
type PG struct {
	DSN string `mapstructure:"dsn"`
}
type RD struct {
	Addr     string `mapstructure:"addr"`
	Password string `mapstructure:"password"`
	DB       int    `mapstructure:"db"`
}
type NATS struct {
	URL string `mapstructure:"url"`
}
type KFK struct {
	Brokers []string `mapstructure:"brokers"`
	Topic   string   `mapstructure:"topic"`
}
type JWT struct {
	Secret   string `mapstructure:"secret"`
	Issuer   string `mapstructure:"issuer"`
	Audience string `mapstructure:"audience"`
}
type AI struct {
	EngineURL string        `mapstructure:"engine_url"`
	Timeout   time.Duration `mapstructure:"timeout"`
}
type Wallet struct {
	BaseURL string        `mapstructure:"base_url"`
	Timeout time.Duration `mapstructure:"timeout"`
}
type LPD struct {
	VirtualReserveMinor int64   `mapstructure:"virtual_reserve_minor"`
	RealReserveMinor    int64   `mapstructure:"real_reserve_minor"`
	GraduationMinor     int64   `mapstructure:"graduation_minor"`
	MaxTokensPerCreator int     `mapstructure:"max_tokens_per_creator"`
	CreatorFeeBps       int     `mapstructure:"creator_fee_bps"`
	PlatformFeeBps      int     `mapstructure:"platform_fee_bps"`
	MinCreatorStake     int64   `mapstructure:"min_creator_stake"`
	EnableModeration    bool    `mapstructure:"enable_moderation"`
	RiskAIEnabled       bool    `mapstructure:"risk_ai_enabled"`
	DefaultCurve        string  `mapstructure:"default_curve"`
	AllowedCurves       []string `mapstructure:"allowed_curves"`
	// graduation target: AMM adapter
	AMMAdapter string `mapstructure:"amm_adapter"`
	AMMBase    string `mapstructure:"amm_base"`
}

func Load() (*Config, error) {
	v := viper.New()
	v.SetEnvPrefix("LAUNCHPAD")
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	v.AutomaticEnv()

	v.SetDefault("env", "development")
	v.SetDefault("service", "launchpad-service")
	v.SetDefault("grpc.port", "50054")
	v.SetDefault("http.port", "8084")

	v.SetDefault("postgres.dsn", "postgres://rial:rial@postgres:5432/rial?sslmode=disable")
	v.SetDefault("redis.addr", "redis:6379")
	v.SetDefault("redis.password", "")
	v.SetDefault("redis.db", 0)

	v.SetDefault("nats.url", "nats://nats:4222")
	v.SetDefault("kafka.brokers", []string{"kafka:9092"})
	v.SetDefault("kafka.topic", "rial.launches.v1")

	v.SetDefault("jwt.secret", "change-me-in-prod")
	v.SetDefault("jwt.issuer", "rial-auth")
	v.SetDefault("jwt.audience", "rial-services")

	v.SetDefault("ai.engine_url", "http://ai-engine:8088")
	v.SetDefault("ai.timeout", "5s")
	v.SetDefault("wallet.base_url", "http://wallet-service:50053")
	v.SetDefault("wallet.timeout", "5s")

	v.SetDefault("launchpad.virtual_reserve_minor", int64(30_000_000_000))
	v.SetDefault("launchpad.real_reserve_minor", int64(0))
	v.SetDefault("launchpad.graduation_minor", int64(69_000_000_000))
	v.SetDefault("launchpad.max_tokens_per_creator", 5)
	v.SetDefault("launchpad.creator_fee_bps", 100)
	v.SetDefault("launchpad.platform_fee_bps", 100)
	v.SetDefault("launchpad.min_creator_stake", int64(100_000_000))
	v.SetDefault("launchpad.enable_moderation", true)
	v.SetDefault("launchpad.risk_ai_enabled", true)
	v.SetDefault("launchpad.default_curve", "sigmoid")
	v.SetDefault("launchpad.allowed_curves", []string{"linear", "exponential", "logarithmic", "sigmoid"})
	v.SetDefault("launchpad.amm_adapter", "raydium-clone")
	v.SetDefault("launchpad.amm_base", "RIAL")

	var c Config
	if err := v.Unmarshal(&c); err != nil { return nil, err }
	if c.Postgres.DSN == "" { return nil, errors.New("LAUNCHPAD_POSTGRES_DSN required") }
	return &c, nil
}
