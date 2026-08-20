package grpc

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/rial/wallet-service/internal/domain"
	"github.com/rial/wallet-service/internal/ledger"
	rialpb "github.com/rial/wallet-service/proto"
)

type walletRPC struct {
	rialpb.UnimplementedWalletServiceServer
	svc         *ledger.Service
	withdrawals *ledger.WithdrawalService
}

func newWalletRPC(svc *ledger.Service) *walletRPC {
	return &walletRPC{svc: svc, withdrawals: ledger.NewWithdrawalService(svc, svc.Custody(), 2)}
}

func (w *walletRPC) GetAccount(ctx context.Context, req *rialpb.GetAccountRequest) (*rialpb.Account, error) {
	userID, err := parseUUID(req.GetUserId())
	if err != nil {
		return nil, invalid("user_id", err)
	}
	account, err := w.svc.GetOrCreateUserAccount(ctx, userID)
	if err != nil {
		return nil, mapLedgerError(err)
	}
	return accountProto(account), nil
}

func (w *walletRPC) Credit(ctx context.Context, req *rialpb.CreditRequest) (*rialpb.Transaction, error) {
	userID, err := parseUUID(req.GetUserId())
	if err != nil {
		return nil, invalid("user_id", err)
	}
	amount, err := parsePositiveAmount(req.GetAmount())
	if err != nil {
		return nil, invalid("amount", err)
	}
	if strings.TrimSpace(req.GetIdempotencyKey()) == "" {
		return nil, invalid("idempotency_key", errors.New("required"))
	}
	account, err := w.svc.GetOrCreateUserAccount(ctx, userID)
	if err != nil {
		return nil, mapLedgerError(err)
	}
	transaction, err := w.svc.Credit(ctx, ledger.CreditParams{
		AccountID: account.ID, Amount: amount, Type: domain.TransactionType(req.GetType()),
		Reference: req.GetReference(), IdempotencyKey: req.GetIdempotencyKey(), Metadata: stringMapAny(req.GetMetadata()), Actor: actorFromContext(ctx),
	})
	if err != nil {
		return nil, mapLedgerError(err)
	}
	return transactionProto(transaction), nil
}

func (w *walletRPC) Debit(ctx context.Context, req *rialpb.DebitRequest) (*rialpb.Transaction, error) {
	userID, err := parseUUID(req.GetUserId())
	if err != nil {
		return nil, invalid("user_id", err)
	}
	amount, err := parsePositiveAmount(req.GetAmount())
	if err != nil {
		return nil, invalid("amount", err)
	}
	if strings.TrimSpace(req.GetIdempotencyKey()) == "" {
		return nil, invalid("idempotency_key", errors.New("required"))
	}
	account, err := w.svc.GetOrCreateUserAccount(ctx, userID)
	if err != nil {
		return nil, mapLedgerError(err)
	}
	transaction, err := w.svc.Debit(ctx, ledger.DebitParams{
		AccountID: account.ID, Amount: amount, Type: domain.TransactionType(req.GetType()),
		Reference: req.GetReference(), IdempotencyKey: req.GetIdempotencyKey(), Actor: actorFromContext(ctx),
	})
	if err != nil {
		return nil, mapLedgerError(err)
	}
	return transactionProto(transaction), nil
}

func (w *walletRPC) Transfer(ctx context.Context, req *rialpb.TransferRequest) (*rialpb.TransferResponse, error) {
	from, err := parseUUID(req.GetFromUserId())
	if err != nil {
		return nil, invalid("from_user_id", err)
	}
	to, err := parseUUID(req.GetToUserId())
	if err != nil {
		return nil, invalid("to_user_id", err)
	}
	amount, err := parsePositiveAmount(req.GetAmount())
	if err != nil {
		return nil, invalid("amount", err)
	}
	if strings.TrimSpace(req.GetIdempotencyKey()) == "" {
		return nil, invalid("idempotency_key", errors.New("required"))
	}
	if err := w.svc.Transfer(ctx, from, to, amount, req.GetReference(), req.GetActor(), req.GetIdempotencyKey(), map[string]any{"service": actorFromContext(ctx)}); err != nil {
		return nil, mapLedgerError(err)
	}
	return &rialpb.TransferResponse{Ok: true}, nil
}

func (w *walletRPC) ListTransactions(ctx context.Context, req *rialpb.ListTransactionsRequest) (*rialpb.ListTransactionsResponse, error) {
	userID, err := parseUUID(req.GetUserId())
	if err != nil {
		return nil, invalid("user_id", err)
	}
	account, err := w.svc.GetOrCreateUserAccount(ctx, userID)
	if err != nil {
		return nil, mapLedgerError(err)
	}
	limit := int(req.GetLimit())
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	offset := int(req.GetOffset())
	if offset < 0 {
		return nil, invalid("offset", errors.New("must not be negative"))
	}
	items, err := w.svc.ListTransactions(ctx, account.ID, limit, offset)
	if err != nil {
		return nil, mapLedgerError(err)
	}
	out := &rialpb.ListTransactionsResponse{Items: make([]*rialpb.Transaction, 0, len(items))}
	for i := range items {
		out.Items = append(out.Items, transactionProto(&items[i]))
	}
	return out, nil
}

func (w *walletRPC) RequestWithdrawal(ctx context.Context, req *rialpb.WithdrawalRequest) (*rialpb.Withdrawal, error) {
	userID, err := parseUUID(req.GetUserId())
	if err != nil {
		return nil, invalid("user_id", err)
	}
	amount, err := parsePositiveAmount(req.GetAmount())
	if err != nil {
		return nil, invalid("amount", err)
	}
	account, err := w.svc.GetOrCreateUserAccount(ctx, userID)
	if err != nil {
		return nil, mapLedgerError(err)
	}
	withdrawal, err := w.withdrawals.Request(ctx, account.ID, amount, req.GetChain(), req.GetDestination(), req.GetIdempotencyKey())
	if err != nil {
		return nil, mapLedgerError(err)
	}
	return withdrawalProto(withdrawal), nil
}

func (w *walletRPC) SignWithdrawal(ctx context.Context, req *rialpb.SignWithdrawalRequest) (*rialpb.Withdrawal, error) {
	withdrawalID, err := parseUUID(req.GetWithdrawalId())
	if err != nil {
		return nil, invalid("withdrawal_id", err)
	}
	if strings.TrimSpace(req.GetSignerId()) == "" {
		return nil, invalid("signer_id", errors.New("required"))
	}
	withdrawal, err := w.withdrawals.Sign(ctx, withdrawalID, req.GetSignerId())
	if err != nil {
		return nil, mapLedgerError(err)
	}
	return withdrawalProto(withdrawal), nil
}

func parseUUID(raw string) (uuid.UUID, error) {
	id, err := uuid.Parse(strings.TrimSpace(raw))
	if err != nil || id == uuid.Nil {
		return uuid.Nil, errors.New("must be a non-zero UUID")
	}
	return id, nil
}

func parsePositiveAmount(raw string) (int64, error) {
	if strings.TrimSpace(raw) == "" {
		return 0, errors.New("required")
	}
	amount, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || amount <= 0 {
		return 0, errors.New("must be a positive signed 64-bit integer string")
	}
	return amount, nil
}

func accountProto(a *domain.Account) *rialpb.Account {
	owner := ""
	if a.OwnerID != nil {
		owner = a.OwnerID.String()
	}
	return &rialpb.Account{Id: a.ID.String(), OwnerId: owner, Kind: string(a.Kind), Symbol: a.Symbol, Balance: strconv.FormatInt(a.Balance, 10), Available: strconv.FormatInt(a.Available, 10), Pending: strconv.FormatInt(a.Pending, 10), Version: strconv.FormatInt(a.Version, 10)}
}

func transactionProto(t *domain.Transaction) *rialpb.Transaction {
	return &rialpb.Transaction{Id: t.ID.String(), AccountId: t.AccountID.String(), Type: string(t.Type), Amount: strconv.FormatInt(t.Amount, 10), BalanceAfter: strconv.FormatInt(t.BalanceAfter, 10), Reference: t.Reference, Actor: t.Actor, IdempotencyKey: t.IdempotencyKey, CreatedAtUnixMs: t.CreatedAt.UnixMilli()}
}

func withdrawalProto(w *domain.Withdrawal) *rialpb.Withdrawal {
	return &rialpb.Withdrawal{Id: w.ID.String(), AccountId: w.AccountID.String(), Amount: strconv.FormatInt(w.Amount, 10), Destination: w.Destination, Chain: w.Chain, Status: string(w.Status), TxHash: w.TxHash, Signers: append([]string(nil), w.Signers...), RequiredSigs: int32(w.RequiredSigs), CreatedAtUnixMs: w.CreatedAt.UnixMilli()}
}

func stringMapAny(in map[string]string) map[string]any {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func actorFromContext(ctx context.Context) string {
	if service, ok := ctx.Value(serviceContextKey{}).(string); ok && service != "" {
		return service
	}
	return "grpc"
}

type serviceContextKey struct{}

func invalid(field string, err error) error {
	return status.Errorf(codes.InvalidArgument, "%s: %v", field, err)
}

func mapLedgerError(err error) error {
	switch {
	case errors.Is(err, ledger.ErrAccountNotFound):
		return status.Error(codes.NotFound, err.Error())
	case errors.Is(err, ledger.ErrInsufficient):
		return status.Error(codes.FailedPrecondition, err.Error())
	case errors.Is(err, ledger.ErrNegativeAmount), errors.Is(err, ledger.ErrInvalidKind), errors.Is(err, ledger.ErrSelfTransfer), errors.Is(err, ledger.ErrDestinationNotWhitelisted), errors.Is(err, ledger.ErrWithdrawalsPaused):
		return status.Error(codes.InvalidArgument, err.Error())
	case errors.Is(err, ledger.ErrIdempotencyClash), errors.Is(err, ledger.ErrWithdrawalIdempotencyClash):
		return status.Error(codes.AlreadyExists, err.Error())
	default:
		return status.Error(codes.Internal, fmt.Sprintf("wallet ledger operation failed: %v", err))
	}
}
