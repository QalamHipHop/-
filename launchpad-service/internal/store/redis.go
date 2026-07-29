// Package store — Redis cache + lock helpers.
package store

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

type RD struct {
	C *redis.Client
}

func NewRedis(ctx context.Context, addr, password string, db int, logger *zap.Logger) (*RD, error) {
	c := redis.NewClient(&redis.Options{Addr: addr, Password: password, DB: db, DialTimeout: 5 * time.Second})
	if err := c.Ping(ctx).Err(); err != nil { return nil, err }
	logger.Info("redis connected", zap.String("addr", addr))
	return &RD{C: c}, nil
}

func (r *RD) Close() error { return r.C.Close() }

// AcquireLock — simple SETNX lock with auto-expiry; returns unlock fn.
func (r *RD) AcquireLock(ctx context.Context, key string, ttl time.Duration) (func() error, error) {
	ok, err := r.C.SetNX(ctx, "lock:"+key, time.Now().UnixNano(), ttl).Result()
	if err != nil { return nil, err }
	if !ok { return nil, errors.New("LOCK_BUSY") }
	return func() error {
		return r.C.Del(ctx, "lock:"+key).Err()
	}, nil
}

func (r *RD) CacheSet(ctx context.Context, key, val string, ttl time.Duration) error {
	return r.C.Set(ctx, "cache:"+key, val, ttl).Err()
}

func (r *RD) CacheGet(ctx context.Context, key string) (string, bool, error) {
	v, err := r.C.Get(ctx, "cache:"+key).Result()
	if errors.Is(err, redis.Nil) { return "", false, nil }
	if err != nil { return "", false, err }
	return v, true, nil
}

func (r *RD) CacheDel(ctx context.Context, keys ...string) {
	_ = r.C.Del(ctx, keys...).Err()
}
