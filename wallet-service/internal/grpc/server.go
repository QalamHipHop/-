package grpc

import (
	"context"
	"crypto/subtle"
	"net"
	"strings"

	"github.com/rs/zerolog/log"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"github.com/rial/wallet-service/internal/config"
	"github.com/rial/wallet-service/internal/ledger"
	rialpb "github.com/rial/wallet-service/proto"
)

type Server struct {
	srv *grpc.Server
	lis net.Listener
	cfg *config.Config
	svc *ledger.Service
}

func NewServer(svc *ledger.Service, cfg *config.Config) *Server {
	server := &Server{cfg: cfg, svc: svc}
	server.srv = grpc.NewServer(grpc.UnaryInterceptor(server.authInterceptor))
	rialpb.RegisterWalletServiceServer(server.srv, newWalletRPC(svc))
	return server
}

func (s *Server) Start(addr string) error {
	l, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	s.lis = l
	// register proto services here once generated (see proto/wallet.proto)
	return s.srv.Serve(l)
}

func (s *Server) GracefulStop() {
	s.srv.GracefulStop()
	if s.lis != nil {
		_ = s.lis.Close()
	}
}

func (s *Server) authInterceptor(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
	md, _ := metadata.FromIncomingContext(ctx)
	service := firstMetadata(md, "x-rial-service")
	provided := firstMetadata(md, "x-rial-internal-token")
	expected := s.cfg.InternalToken
	if scoped, ok := s.cfg.ServiceTokens[service]; ok && scoped != "" {
		expected = scoped
	} else if s.cfg.Env == "production" {
		return nil, status.Error(codes.Unauthenticated, "service scope required")
	}
	if expected == "" || provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
		return nil, status.Error(codes.Unauthenticated, "internal authentication required")
	}
	ctx = context.WithValue(ctx, serviceContextKey{}, service)
	log.Info().Str("method", info.FullMethod).Str("service", service).Msg("grpc call")
	return handler(ctx, req)
}

func firstMetadata(md metadata.MD, key string) string {
	values := md.Get(strings.ToLower(key))
	if len(values) == 0 {
		return ""
	}
	return values[0]
}
