// Package middleware — gRPC interceptors and HTTP middlewares.
package middleware

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type ctxKey string

const userKey ctxKey = "user"

// ChainUnary chains multiple unary interceptors into one.
func ChainUnary(interceptors ...grpc.UnaryServerInterceptor) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		chained := func(currCtx context.Context, currReq interface{}) (interface{}, error) {
			return handler(currCtx, currReq)
		}
		// apply in reverse so the first interceptor is the outermost
		for i := len(interceptors) - 1; i >= 0; i-- {
			interceptor := interceptors[i]
			next := chained
			chained = func(currCtx context.Context, currReq interface{}) (interface{}, error) {
				return interceptor(currCtx, currReq, info, next)
			}
		}
		return chained(ctx, req)
	}
}

func Recovery(log *zap.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (resp interface{}, err error) {
		defer func() {
			if r := recover(); r != nil {
				log.Error("panic", zap.Any("r", r), zap.String("method", info.FullMethod))
				err = status.Errorf(codes.Internal, "internal error")
			}
		}()
		return handler(ctx, req)
	}
}

func Logging(log *zap.Logger) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		start := time.Now()
		resp, err := handler(ctx, req)
		dur := time.Since(start)
		log.Info("rpc", zap.String("method", info.FullMethod), zap.Duration("dur", dur), zap.Error(err))
		return resp, err
	}
}

// JWTAuth — extracts `authorization: Bearer <jwt>` and verifies it.
// Public methods (Health, Healthz) should be registered separately.
func JWTAuth(secret, issuer, audience string) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		if isPublic(info.FullMethod) { return handler(ctx, req) }
		md, _ := metadata.FromIncomingContext(ctx)
		raw := first(md, "authorization")
		if raw == "" { return nil, status.Error(codes.Unauthenticated, "missing authorization") }
		raw = strings.TrimPrefix(raw, "Bearer ")
		tok, err := jwt.Parse(raw, func(t *jwt.Token) (interface{}, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok { return nil, errors.New("bad alg") }
			return []byte(secret), nil
		}, jwt.WithIssuer(issuer), jwt.WithAudience(audience))
		if err != nil || !tok.Valid { return nil, status.Error(codes.Unauthenticated, "invalid token") }
		if claims, ok := tok.Claims.(jwt.MapClaims); ok {
			ctx = context.WithValue(ctx, userKey, claims)
		}
		return handler(ctx, req)
	}
}

func UserFromContext(ctx context.Context) (jwt.MapClaims, bool) {
	v, ok := ctx.Value(userKey).(jwt.MapClaims)
	return v, ok
}

func isPublic(method string) bool {
	return strings.HasSuffix(method, "/Health") || strings.HasSuffix(method, "/Healthz")
}

func first(md metadata.MD, key string) string {
	v := md.Get(key)
	if len(v) == 0 { return "" }
	return v[0]
}

func HTTPTracing(next http.Handler, log *zap.Logger) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rw, r)
		log.Info("http", zap.String("method", r.Method), zap.String("path", r.URL.Path), zap.Int("status", rw.status), zap.Duration("dur", time.Since(start)))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}
func (s *statusRecorder) WriteHeader(c int) { s.status = c; s.ResponseWriter.WriteHeader(c) }
