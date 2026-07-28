package grpc

import (
	"context"
	"net"

	"github.com/rs/zerolog/log"
	"google.golang.org/grpc"

	"github.com/rial/wallet-service/internal/config"
	"github.com/rial/wallet-service/internal/ledger"
)

type Server struct {
	srv *grpc.Server
	lis net.Listener
	cfg *config.Config
	svc *ledger.Service
}

func NewServer(svc *ledger.Service, cfg *config.Config) *Server {
	s := grpc.NewServer(grpc.UnaryInterceptor(loggingInterceptor))
	return &Server{cfg: cfg, svc: svc, srv: s}
}

func (s *Server) Start(addr string) error {
	l, err := net.Listen("tcp", addr)
	if err != nil { return err }
	s.lis = l
	// register proto services here once generated (see proto/wallet.proto)
	return s.srv.Serve(l)
}

func (s *Server) GracefulStop() {
	s.srv.GracefulStop()
	if s.lis != nil { _ = s.lis.Close() }
}

func loggingInterceptor(ctx context.Context, req any, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (any, error) {
	log.Info().Str("method", info.FullMethod).Msg("grpc call")
	return handler(ctx, req)
}
