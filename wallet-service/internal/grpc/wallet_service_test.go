package grpc

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"

	"github.com/rial/wallet-service/internal/config"
	"github.com/rial/wallet-service/internal/domain"
	"github.com/rial/wallet-service/internal/ledger"
)

func TestParsePositiveAmountIsStrictAndInt64Safe(t *testing.T) {
	for _, tc := range []struct {
		name  string
		raw   string
		valid bool
		want  int64
	}{
		{name: "valid max int64", raw: "9223372036854775807", valid: true, want: 9223372036854775807},
		{name: "zero", raw: "0"},
		{name: "negative", raw: "-1"},
		{name: "decimal", raw: "1.00"},
		{name: "float", raw: "1e3"},
		{name: "overflow", raw: "9223372036854775808"},
		{name: "empty", raw: ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parsePositiveAmount(tc.raw)
			if tc.valid {
				if err != nil || got != tc.want {
					t.Fatalf("parsePositiveAmount(%q) = %d, %v; want %d, nil", tc.raw, got, err, tc.want)
				}
				return
			}
			if err == nil {
				t.Fatalf("parsePositiveAmount(%q) unexpectedly succeeded with %d", tc.raw, got)
			}
		})
	}
}

func TestFinancialProtoMappingUsesDecimalStrings(t *testing.T) {
	id := uuid.New()
	now := time.UnixMilli(1710000000123).UTC()
	account := accountProto(&domain.Account{ID: id, Kind: domain.AccountUser, Symbol: "RIAL", Balance: 9223372036854775807, Available: 123456789, Pending: 7, Version: 42})
	if account.Balance != "9223372036854775807" || account.Available != "123456789" || account.Pending != "7" || account.Version != "42" {
		t.Fatalf("account monetary mapping lost precision: %+v", account)
	}
	transaction := transactionProto(&domain.Transaction{ID: id, AccountID: id, Type: domain.TxTrade, Amount: -9223372036854775807, BalanceAfter: 123, CreatedAt: now})
	if transaction.Amount != "-9223372036854775807" || transaction.BalanceAfter != "123" || transaction.CreatedAtUnixMs != 1710000000123 {
		t.Fatalf("transaction mapping is not exact: %+v", transaction)
	}
}

func TestAuthInterceptorRequiresScopedTokenInProduction(t *testing.T) {
	s := &Server{cfg: &config.Config{Env: "production", ServiceTokens: map[string]string{"backend": "backend-secret"}}}
	handler := func(ctx context.Context, req any) (any, error) {
		if got := actorFromContext(ctx); got != "backend" {
			t.Fatalf("actorFromContext() = %q, want backend", got)
		}
		return "ok", nil
	}
	info := &grpc.UnaryServerInfo{FullMethod: "/rial.wallet.v1.WalletService/GetAccount"}

	_, err := s.authInterceptor(context.Background(), nil, info, handler)
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("missing auth status = %v, want Unauthenticated", status.Code(err))
	}

	wrong := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-rial-service", "backend", "x-rial-internal-token", "wrong"))
	_, err = s.authInterceptor(wrong, nil, info, handler)
	if status.Code(err) != codes.Unauthenticated {
		t.Fatalf("wrong auth status = %v, want Unauthenticated", status.Code(err))
	}

	valid := metadata.NewIncomingContext(context.Background(), metadata.Pairs("x-rial-service", "backend", "x-rial-internal-token", "backend-secret"))
	got, err := s.authInterceptor(valid, nil, info, handler)
	if err != nil || got != "ok" {
		t.Fatalf("valid auth = %v, %v; want ok, nil", got, err)
	}
}

func TestMapLedgerErrorPreservesDomainSemantics(t *testing.T) {
	cases := []struct {
		err  error
		code codes.Code
	}{
		{ledger.ErrAccountNotFound, codes.NotFound},
		{ledger.ErrInsufficient, codes.FailedPrecondition},
		{ledger.ErrIdempotencyClash, codes.AlreadyExists},
		{ledger.ErrNegativeAmount, codes.InvalidArgument},
		{errors.New("database unavailable"), codes.Internal},
	}
	for _, tc := range cases {
		if got := status.Code(mapLedgerError(tc.err)); got != tc.code {
			t.Errorf("mapLedgerError(%v) = %v, want %v", tc.err, got, tc.code)
		}
	}
}
