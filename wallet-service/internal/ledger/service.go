// Package ledger implements double-entry bookkeeping for RIAL.

// Rules:
//   - Every state change is a row in `wallet.transactions` AND a row in `shared.outbox`.
//   - Reads of balance are guarded by an advisory lock + optimistic version check.
//   - Idempotency-Key is unique per (account_id, key) and replays the same transaction.
//   - Withdrawals are created in `pending`, moved to `signing` once multi-sig collects.
package ledger

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog/log"

	"github.com/rial/wallet-service/internal/config"
	"github.com/rial/wallet-service/internal/custody"
	"github.com/rial/wallet-service/internal/domain"
	"github.com/rial/wallet-service/internal/event"
)

var jsonMarshalImpl = json.Marshal

var (
	ErrInsufficient               = errors.New("insufficient available balance")
	ErrAccountNotFound            = errors.New("account not found")
	ErrNegativeAmount             = errors.New("amount must be positive")
	ErrIdempotencyClash           = errors.New("idempotency key already used with different parameters")
	ErrVersionConflict            = errors.New("optimistic version conflict, retry")
	ErrInvalidKind                = errors.New("invalid account kind for operation")
	ErrWithdrawalIdempotencyClash = errors.New("withdrawal idempotency key already used with different parameters")
	ErrTransferInconsistent       = errors.New("transfer idempotency state is inconsistent")
	ErrSelfTransfer               = errors.New("source and destination accounts must differ")
	ErrWithdrawalsPaused          = errors.New("withdrawals are temporarily paused")
	ErrDestinationNotWhitelisted  = errors.New("withdrawal destination is not whitelisted")
)

type Service struct {
	pg         *pgxpool.Pool
	rds        *redis.Client
	publisher  *event.NATSPublisher
	audit      *event.KafkaAudit
	custody    custody.Signer
	settlement config.SettlementConfig
}

func NewService(pg *pgxpool.Pool, rds *redis.Client, p *event.NATSPublisher, a *event.KafkaAudit, c custody.Signer, s config.SettlementConfig) *Service {
	return &Service{pg: pg, rds: rds, publisher: p, audit: a, custody: c, settlement: s}
}

// Custody returns the configured signer for withdrawal orchestration.
// Author: QalamHipHop
func (s *Service) Custody() custody.Signer { return s.custody }

// EnsureInternalAccount creates reserve / treasury accounts if they don't exist.
func (s *Service) EnsureInternalAccount(ctx context.Context, kind domain.AccountKind) (*domain.Account, error) {
	if kind != domain.AccountReserve && kind != domain.AccountTreasury && kind != domain.AccountHot && kind != domain.AccountCold {
		return nil, ErrInvalidKind
	}
	a := &domain.Account{ID: uuid.New(), Kind: kind, Symbol: s.settlement.Symbol}
	row := s.pg.QueryRow(ctx, `
		INSERT INTO wallet.accounts (id, owner_id, kind, symbol, balance, available, pending, version)
		VALUES ($1, NULL, $2, $3, 0, 0, 0, 0)
		ON CONFLICT (kind) WHERE owner_id IS NULL AND kind = $2
		DO UPDATE SET updated_at = now()
		RETURNING id, owner_id, kind, symbol, balance, available, pending, version, created_at, updated_at
	`, a.ID, string(kind), s.settlement.Symbol)
	var acc domain.Account
	var owner *uuid.UUID
	if err := row.Scan(&acc.ID, &owner, &acc.Kind, &acc.Symbol, &acc.Balance, &acc.Available, &acc.Pending, &acc.Version, &acc.CreatedAt, &acc.UpdatedAt); err != nil {
		return nil, fmt.Errorf("upsert internal: %w", err)
	}
	acc.OwnerID = owner
	return &acc, nil
}

// GetOrCreateUserAccount returns the user's account, creating it on first access.
func (s *Service) GetOrCreateUserAccount(ctx context.Context, userID uuid.UUID) (*domain.Account, error) {
	tx, err := s.pg.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	row := tx.QueryRow(ctx, `SELECT id, owner_id, kind, symbol, balance, available, pending, version, created_at, updated_at
		FROM wallet.accounts WHERE owner_id = $1 AND kind = 'user' FOR UPDATE`, userID)
	var acc domain.Account
	var owner *uuid.UUID
	if err := row.Scan(&acc.ID, &owner, &acc.Kind, &acc.Symbol, &acc.Balance, &acc.Available, &acc.Pending, &acc.Version, &acc.CreatedAt, &acc.UpdatedAt); err != nil {
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		// create
		acc = domain.Account{
			ID: uuid.New(), OwnerID: &userID, Kind: domain.AccountUser, Symbol: s.settlement.Symbol,
		}
		if err := tx.QueryRow(ctx, `INSERT INTO wallet.accounts (id, owner_id, kind, symbol) VALUES ($1,$2,'user',$3)
			RETURNING id, owner_id, kind, symbol, balance, available, pending, version, created_at, updated_at`,
			acc.ID, userID, s.settlement.Symbol,
		).Scan(&acc.ID, &owner, &acc.Kind, &acc.Symbol, &acc.Balance, &acc.Available, &acc.Pending, &acc.Version, &acc.CreatedAt, &acc.UpdatedAt); err != nil {
			return nil, fmt.Errorf("create user account: %w", err)
		}
	}
	acc.OwnerID = owner
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &acc, nil
}

// Credit increases the available balance of an account and writes a transaction
// row + outbox event atomically. Idempotent on (account_id, idempotency_key).
func (s *Service) Credit(ctx context.Context, p CreditParams) (*domain.Transaction, error) {
	if p.Amount <= 0 {
		return nil, ErrNegativeAmount
	}
	if p.IdempotencyKey == "" {
		return nil, errors.New("idempotency_key required")
	}
	return s.applyDelta(ctx, p, true)
}

// Debit decreases the available balance. Fails with ErrInsufficient if not enough.
func (s *Service) Debit(ctx context.Context, p DebitParams) (*domain.Transaction, error) {
	if p.Amount <= 0 {
		return nil, ErrNegativeAmount
	}
	if p.IdempotencyKey == "" {
		return nil, errors.New("idempotency_key required")
	}
	return s.applyDelta(ctx, CreditParams{
		AccountID: p.AccountID, Amount: -p.Amount, Type: p.Type, Reference: p.Reference,
		Metadata: p.Metadata, Actor: p.Actor, IdempotencyKey: p.IdempotencyKey,
	}, false)
}

type CreditParams struct {
	AccountID      uuid.UUID
	Amount         int64
	Type           domain.TransactionType
	Reference      string
	Metadata       map[string]any
	Actor          string
	IdempotencyKey string
}
type DebitParams = CreditParams

// Reserve moves spendable funds into pending escrow without changing total balance.
// It is used by order placement and must be paired with an idempotent release or settlement.
func (s *Service) Reserve(ctx context.Context, p CreditParams) (*domain.Transaction, error) {
	return s.movePending(ctx, p, true)
}

// Release moves funds from pending escrow back to spendable balance.
func (s *Service) Release(ctx context.Context, p CreditParams) (*domain.Transaction, error) {
	return s.movePending(ctx, p, false)
}

func (s *Service) movePending(ctx context.Context, p CreditParams, reserve bool) (*domain.Transaction, error) {
	if p.Amount <= 0 {
		return nil, ErrNegativeAmount
	}
	if p.IdempotencyKey == "" {
		return nil, errors.New("idempotency_key required")
	}
	tx, err := s.pg.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var prev domain.Transaction
	var metaJSON []byte
	row := tx.QueryRow(ctx, `SELECT id, account_id, type, amount, balance_after, reference, metadata, actor, idempotency_key, created_at FROM wallet.transactions WHERE account_id=$1 AND idempotency_key=$2`, p.AccountID, p.IdempotencyKey)
	existingErr := row.Scan(&prev.ID, &prev.AccountID, &prev.Type, &prev.Amount, &prev.BalanceAfter, &prev.Reference, &metaJSON, &prev.Actor, &prev.IdempotencyKey, &prev.CreatedAt)
	if existingErr == nil {
		expectedAmount := p.Amount
		if reserve {
			expectedAmount = -p.Amount
		}
		if prev.Amount == expectedAmount && prev.Reference == p.Reference {
			if err := tx.Commit(ctx); err != nil {
				return nil, err
			}
			return &prev, nil
		}
		return nil, ErrIdempotencyClash
	}
	if !errors.Is(existingErr, pgx.ErrNoRows) {
		return nil, existingErr
	}
	var balance, available, pending, version int64
	if err := tx.QueryRow(ctx, `SELECT balance, available, pending, version FROM wallet.accounts WHERE id=$1 FOR UPDATE`, p.AccountID).Scan(&balance, &available, &pending, &version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAccountNotFound
		}
		return nil, err
	}
	if reserve {
		if available < p.Amount {
			return nil, ErrInsufficient
		}
		available -= p.Amount
		pending += p.Amount
	} else {
		if pending < p.Amount {
			return nil, ErrInsufficient
		}
		pending -= p.Amount
		available += p.Amount
	}
	newVersion := version + 1
	if _, err := tx.Exec(ctx, `UPDATE wallet.accounts SET balance=$1, available=$2, pending=$3, version=$4, updated_at=now() WHERE id=$5 AND version=$6`, balance, available, pending, newVersion, p.AccountID, version); err != nil {
		return nil, err
	}
	txType := domain.TxRelease
	if reserve {
		txType = domain.TxReserve
	}
	amount := -p.Amount
	if !reserve {
		amount = p.Amount
	}
	metaBytes, _ := jsonMarshal(p.Metadata)
	txID := uuid.New()
	if _, err := tx.Exec(ctx, `INSERT INTO wallet.transactions (id, account_id, type, amount, balance_after, reference, metadata, actor, idempotency_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`, txID, p.AccountID, string(txType), amount, balance, p.Reference, metaBytes, p.Actor, p.IdempotencyKey, time.Now().UTC()); err != nil {
		return nil, err
	}
	payloadBytes, _ := jsonMarshal(map[string]any{"transaction_id": txID, "account_id": p.AccountID, "type": txType, "amount": amount, "balance_after": balance, "reference": p.Reference})
	payloadHash := sha256.Sum256(payloadBytes)
	prevHash := s.lastHash(ctx, tx, p.AccountID)
	linked := sha256.Sum256(append(prevHash, payloadHash[:]...))
	if _, err := tx.Exec(ctx, `INSERT INTO shared.outbox (id, aggregate, aggregate_id, event_type, payload, payload_hash, prev_hash, source_service) VALUES ($1,'wallet',$2,$3,$4::jsonb,$5,$6,'wallet')`, uuid.New(), p.AccountID.String(), "wallet."+string(txType), payloadBytes, payloadHash[:], linked[:]); err != nil {
		return nil, err
	}
	if err := s.writeAudit(ctx, tx, p, payloadHash[:], linked[:]); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	_ = s.rds.Del(ctx, balanceKey(p.AccountID)).Err()
	return &domain.Transaction{ID: txID, AccountID: p.AccountID, Type: txType, Amount: amount, BalanceAfter: balance, Reference: p.Reference, IdempotencyKey: p.IdempotencyKey, CreatedAt: time.Now().UTC()}, nil
}

func (s *Service) applyDelta(ctx context.Context, p CreditParams, isCredit bool) (*domain.Transaction, error) {
	tx, err := s.pg.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// 1) Idempotency check
	existing := tx.QueryRow(ctx, `SELECT id, account_id, type, amount, balance_after, reference, metadata, actor, idempotency_key, created_at
		FROM wallet.transactions WHERE account_id = $1 AND idempotency_key = $2`, p.AccountID, p.IdempotencyKey)
	var prev domain.Transaction
	var metaJSON []byte
	if err := existing.Scan(&prev.ID, &prev.AccountID, &prev.Type, &prev.Amount, &prev.BalanceAfter, &prev.Reference, &metaJSON, &prev.Actor, &prev.IdempotencyKey, &prev.CreatedAt); err == nil {
		_ = prev
		// same key already used with same amount & type => return cached
		if prev.Amount == p.Amount && prev.Type == p.Type && prev.Reference == p.Reference {
			if err := tx.Commit(ctx); err != nil {
				return nil, err
			}
			return &prev, nil
		}
		return nil, ErrIdempotencyClash
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	// 2) Lock account row + check available
	var balance, available, pending, version int64
	if err := tx.QueryRow(ctx, `SELECT balance, available, pending, version FROM wallet.accounts WHERE id = $1 FOR UPDATE`, p.AccountID).
		Scan(&balance, &available, &pending, &version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAccountNotFound
		}
		return nil, err
	}
	if !isCredit && available < p.Amount {
		return nil, ErrInsufficient
	}

	// 3) Compute new balances
	newAvailable := available + p.Amount
	if newAvailable < 0 {
		return nil, ErrInsufficient
	}
	newBalance := balance + p.Amount
	newVersion := version + 1

	if _, err := tx.Exec(ctx, `UPDATE wallet.accounts SET balance = $1, available = $2, pending = $3, version = $4, updated_at = now() WHERE id = $5 AND version = $6`,
		newBalance, newAvailable, pending, newVersion, p.AccountID, version); err != nil {
		return nil, fmt.Errorf("update account: %w", err)
	}

	// 4) Write transaction row
	metaBytes, _ := jsonMarshal(p.Metadata)
	txID := uuid.New()
	if _, err := tx.Exec(ctx, `INSERT INTO wallet.transactions
		(id, account_id, type, amount, balance_after, reference, metadata, actor, idempotency_key, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
		txID, p.AccountID, string(p.Type), p.Amount, newBalance, p.Reference, metaBytes, p.Actor, p.IdempotencyKey, time.Now().UTC()); err != nil {
		return nil, fmt.Errorf("insert tx: %w", err)
	}

	// 5) Outbox + audit hash chain
	payloadBytes, _ := jsonMarshal(map[string]any{
		"transaction_id": txID, "account_id": p.AccountID, "type": p.Type,
		"amount": p.Amount, "balance_after": newBalance, "reference": p.Reference,
	})
	payloadHash := sha256.Sum256(payloadBytes)
	prevHash := s.lastHash(ctx, tx, p.AccountID)
	linked := sha256.Sum256(append(prevHash, payloadHash[:]...))
	if _, err := tx.Exec(ctx, `INSERT INTO shared.outbox
		(id, aggregate, aggregate_id, event_type, payload, payload_hash, prev_hash, source_service)
		VALUES ($1, 'wallet', $2, $3, $4::jsonb, $5, $6, 'wallet')`,
		uuid.New(), p.AccountID.String(), "wallet."+string(p.Type), payloadBytes, payloadHash[:], linked[:]); err != nil {
		return nil, fmt.Errorf("outbox: %w", err)
	}
	if err := s.writeAudit(ctx, tx, p, payloadHash[:], linked[:]); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	// 6) Invalidate cache. Publication is owned exclusively by the durable outbox relay;
	// direct best-effort publication here could create duplicate downstream events.
	_ = s.rds.Del(ctx, balanceKey(p.AccountID)).Err()

	return &domain.Transaction{
		ID: txID, AccountID: p.AccountID, Type: p.Type, Amount: p.Amount, BalanceAfter: newBalance,
		Reference: p.Reference, Actor: p.Actor, IdempotencyKey: p.IdempotencyKey, CreatedAt: time.Now().UTC(),
	}, nil
}

func (s *Service) publishAsync(subject string, body []byte) {
	ctx, cc := context.WithTimeout(context.Background(), 3*time.Second)
	defer cc()
	if err := s.publisher.Publish(ctx, subject, body); err != nil {
		log.Warn().Err(err).Str("subject", subject).Msg("publish failed")
	}
}

// ListTransactions returns paginated history for an account.
func (s *Service) ListTransactions(ctx context.Context, accountID uuid.UUID, limit, offset int) ([]domain.Transaction, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.pg.Query(ctx, `SELECT id, account_id, type, amount, balance_after, reference, metadata, actor, idempotency_key, created_at
		FROM wallet.transactions WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, accountID, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.Transaction, 0, limit)
	for rows.Next() {
		var t domain.Transaction
		var meta []byte
		if err := rows.Scan(&t.ID, &t.AccountID, &t.Type, &t.Amount, &t.BalanceAfter, &t.Reference, &meta, &t.Actor, &t.IdempotencyKey, &t.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// Transfer moves funds between two accounts atomically (debit + credit in one tx).
// SettleDeposit moves already-cleared funds from the internal reserve account to a user.
// It is deliberately separate from Credit: verified payment settlement must have a
// balanced source leg and must never mint user balance from an empty source.
func (s *Service) SettleDeposit(ctx context.Context, userID uuid.UUID, amount int64, reference, idemKey string, meta map[string]any) (*domain.Transaction, error) {
	if userID == uuid.Nil {
		return nil, errors.New("user_id required")
	}
	if amount <= 0 {
		return nil, ErrNegativeAmount
	}
	user, err := s.GetOrCreateUserAccount(ctx, userID)
	if err != nil {
		return nil, err
	}
	reserve, err := s.EnsureInternalAccount(ctx, domain.AccountReserve)
	if err != nil {
		return nil, err
	}
	settlementMeta := map[string]any{}
	for k, v := range meta {
		settlementMeta[k] = v
	}
	settlementMeta["transaction_type"] = string(domain.TxDeposit)
	if err := s.Transfer(ctx, reserve.ID, user.ID, amount, reference, "payment-settlement", idemKey, settlementMeta); err != nil {
		return nil, err
	}
	var tx domain.Transaction
	var metaJSON []byte
	err = s.pg.QueryRow(ctx, `SELECT id, account_id, type, amount, balance_after, reference, metadata, actor, idempotency_key, created_at
		FROM wallet.transactions WHERE account_id=$1 AND idempotency_key=$2`, user.ID, idemKey+":to").Scan(
		&tx.ID, &tx.AccountID, &tx.Type, &tx.Amount, &tx.BalanceAfter, &tx.Reference, &metaJSON, &tx.Actor, &tx.IdempotencyKey, &tx.CreatedAt)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(metaJSON, &tx.Metadata); err != nil {
		return nil, err
	}
	return &tx, nil
}

func (s *Service) Transfer(ctx context.Context, from, to uuid.UUID, amount int64, reference, actor, idemKey string, meta map[string]any) error {
	if amount <= 0 {
		return ErrNegativeAmount
	}
	if idemKey == "" {
		return errors.New("idempotency_key required")
	}
	if from == to {
		return ErrSelfTransfer
	}
	tx, err := s.pg.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Replay is checked before any balance mutation. A complete pair is a
	// successful retry; a single leg means a previous transaction was
	// corrupted and must fail closed instead of creating a third leg.
	fromExisting, err := transferLeg(ctx, tx, from, idemKey, -amount, reference)
	if err != nil {
		return err
	}
	toExisting, err := transferLeg(ctx, tx, to, idemKey+":to", amount, reference+":to")
	if err != nil {
		return err
	}
	if fromExisting || toExisting {
		if fromExisting && toExisting {
			return tx.Commit(ctx)
		}
		return ErrTransferInconsistent
	}

	// Lock both accounts in UUID order before applying either leg. This makes
	// opposite-direction concurrent transfers acquire locks consistently.
	if err := lockTransferAccounts(ctx, tx, from, to); err != nil {
		return err
	}
	txType := domain.TxTransfer
	if raw, ok := meta["transaction_type"].(string); ok && raw == string(domain.TxDeposit) {
		txType = domain.TxDeposit
	}
	if _, err := s.applyWithinTx(ctx, tx, from, -amount, txType, reference, actor, idemKey, meta); err != nil {
		return err
	}
	if _, err := s.applyWithinTx(ctx, tx, to, amount, txType, reference+":to", actor, idemKey+":to", meta); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func transferLeg(ctx context.Context, tx pgx.Tx, accountID uuid.UUID, idemKey string, amount int64, reference string) (bool, error) {
	var existingAmount int64
	var existingReference string
	err := tx.QueryRow(ctx, `SELECT amount, reference FROM wallet.transactions WHERE account_id = $1 AND idempotency_key = $2`, accountID, idemKey).Scan(&existingAmount, &existingReference)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if existingAmount != amount || existingReference != reference {
		return false, ErrIdempotencyClash
	}
	return true, nil
}

func lockTransferAccounts(ctx context.Context, tx pgx.Tx, from, to uuid.UUID) error {
	rows, err := tx.Query(ctx, `SELECT id FROM wallet.accounts WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`, from, to)
	if err != nil {
		return err
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		count++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if count != 2 {
		return ErrAccountNotFound
	}
	return nil
}

func (s *Service) applyWithinTx(ctx context.Context, tx pgx.Tx, accID uuid.UUID, amount int64, kind domain.TransactionType, ref, actor, idemKey string, meta map[string]any) (int64, error) {
	var balance, available, pending, version int64
	if err := tx.QueryRow(ctx, `SELECT balance, available, pending, version FROM wallet.accounts WHERE id = $1 FOR UPDATE`, accID).
		Scan(&balance, &available, &pending, &version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, ErrAccountNotFound
		}
		return 0, err
	}
	if amount < 0 && available < -amount {
		return 0, ErrInsufficient
	}
	newAvailable := available + amount
	newBalance := balance + amount
	newVersion := version + 1
	if _, err := tx.Exec(ctx, `UPDATE wallet.accounts SET balance=$1, available=$2, pending=$3, version=$4, updated_at=now() WHERE id=$5 AND version=$6`,
		newBalance, newAvailable, pending, newVersion, accID, version); err != nil {
		return 0, err
	}
	metaBytes, _ := jsonMarshal(meta)
	txID := uuid.New()
	if _, err := tx.Exec(ctx, `INSERT INTO wallet.transactions
			(id, account_id, type, amount, balance_after, reference, metadata, actor, idempotency_key, created_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,now())`,
		txID, accID, string(kind), amount, newBalance, ref, metaBytes, actor, idemKey); err != nil {
		return 0, err
	}
	payloadBytes, err := jsonMarshal(map[string]any{
		"transaction_id": txID, "account_id": accID, "type": kind,
		"amount": amount, "balance_after": newBalance, "reference": ref,
	})
	if err != nil {
		return 0, err
	}
	payloadHash := sha256.Sum256(payloadBytes)
	prevHash := s.lastHash(ctx, tx, accID)
	linked := sha256.Sum256(append(prevHash, payloadHash[:]...))
	if _, err := tx.Exec(ctx, `INSERT INTO shared.outbox
			(id, aggregate, aggregate_id, event_type, payload, payload_hash, prev_hash, source_service)
			VALUES ($1, 'wallet', $2, $3, $4::jsonb, $5, $6, 'wallet')`,
		uuid.New(), accID.String(), "wallet."+string(kind), payloadBytes, payloadHash[:], linked[:]); err != nil {
		return 0, fmt.Errorf("outbox: %w", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO shared.audit
			(aggregate, aggregate_id, actor, action, payload, payload_hash, prev_hash)
			VALUES ('wallet', $1, $2, $3, $4::jsonb, $5, $6)`,
		accID.String(), actor, string(kind), marshalOrEmpty(meta), payloadHash[:], linked[:]); err != nil {
		return 0, err
	}
	return newBalance, nil
}

// helpers
func balanceKey(id uuid.UUID) string { return "balance:" + id.String() }
func (s *Service) lastHash(ctx context.Context, tx pgx.Tx, accountID uuid.UUID) []byte {
	var h []byte
	_ = tx.QueryRow(ctx, `SELECT payload_hash FROM shared.outbox WHERE aggregate='wallet' AND aggregate_id=$1 ORDER BY created_at DESC LIMIT 1`, accountID.String()).Scan(&h)
	return h
}
func (s *Service) writeAudit(ctx context.Context, tx pgx.Tx, p CreditParams, payloadHash, linked []byte) error {
	_, err := tx.Exec(ctx, `INSERT INTO shared.audit
		(aggregate, aggregate_id, actor, action, payload, payload_hash, prev_hash)
		VALUES ('wallet', $1, $2, $3, $4::jsonb, $5, $6)`,
		p.AccountID.String(), p.Actor, string(p.Type), marshalOrEmpty(p.Metadata), payloadHash, linked)
	return err
}

func marshalOrEmpty(v map[string]any) []byte {
	if v == nil {
		return []byte("{}")
	}
	b, _ := jsonMarshal(v)
	return b
}
func jsonMarshal(v any) ([]byte, error) {
	if v == nil {
		return []byte("null"), nil
	}
	return jsonMarshalImpl(v)
}
