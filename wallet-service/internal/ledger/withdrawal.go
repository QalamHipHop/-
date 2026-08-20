// Author: QalamHipHop
package ledger

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/rial/wallet-service/internal/custody"
	"github.com/rial/wallet-service/internal/domain"
)

type WithdrawalService struct {
	svc               *Service
	signer            custody.Signer
	required          int
	whitelistRequired bool
	allowedSignerIDs  map[string]struct{}
}

func NewWithdrawalService(svc *Service, signer custody.Signer, required int) *WithdrawalService {
	if required < 1 {
		required = 1
	}
	allowed := make(map[string]struct{}, len(svc.settlement.AllowedSignerIDs))
	for _, id := range svc.settlement.AllowedSignerIDs {
		if id != "" {
			allowed[id] = struct{}{}
		}
	}
	return &WithdrawalService{svc: svc, signer: signer, required: required, whitelistRequired: svc.settlement.WithdrawalWhitelistRequired, allowedSignerIDs: allowed}
}

// Request atomically reserves funds and creates exactly one withdrawal per
// (account_id, idempotency_key). A retry returns the original aggregate.
func (w *WithdrawalService) Request(ctx context.Context, accountID uuid.UUID, amount int64, chain, destination, idemKey string) (*domain.Withdrawal, error) {
	if amount <= 0 {
		return nil, ErrNegativeAmount
	}
	if destination == "" || chain == "" || idemKey == "" {
		return nil, errors.New("destination, chain and idempotency key are required")
	}

	tx, err := w.svc.pg.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var existingID uuid.UUID
	var existingAmount int64
	var existingDestination, existingChain, existingStatus string
	err = tx.QueryRow(ctx, `SELECT id, amount, destination, chain, status
		FROM wallet.withdrawals WHERE account_id=$1 AND idempotency_key=$2`, accountID, idemKey).
		Scan(&existingID, &existingAmount, &existingDestination, &existingChain, &existingStatus)
	if err == nil {
		if existingAmount != amount || existingDestination != destination || existingChain != chain {
			return nil, ErrWithdrawalIdempotencyClash
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return w.get(ctx, existingID)
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	var paused bool
	if err := tx.QueryRow(ctx, `SELECT COALESCE((value = 'true'::jsonb), false)
		FROM operations.platform_settings WHERE key = 'withdrawals_paused'`).Scan(&paused); err != nil {
		return nil, err
	}
	if paused {
		return nil, ErrWithdrawalsPaused
	}
	if w.whitelistRequired {
		var allowed bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS(
			SELECT 1 FROM wallet.withdrawal_destinations
			WHERE account_id=$1 AND chain=$2 AND destination=$3
			  AND status='active' AND (cooldown_until IS NULL OR cooldown_until <= now())
		)`, accountID, chain, destination).Scan(&allowed); err != nil {
			return nil, err
		}
		if !allowed {
			return nil, ErrDestinationNotWhitelisted
		}
	}

	var balance, available, pending, version int64
	if err := tx.QueryRow(ctx, `SELECT balance, available, pending, version
		FROM wallet.accounts WHERE id=$1 FOR UPDATE`, accountID).
		Scan(&balance, &available, &pending, &version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrAccountNotFound
		}
		return nil, err
	}
	if available < amount {
		return nil, ErrInsufficient
	}
	if _, err := tx.Exec(ctx, `UPDATE wallet.accounts
		SET available=available-$1, pending=pending+$1, version=version+1, updated_at=now()
		WHERE id=$2 AND version=$3`, amount, accountID, version); err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	wd := &domain.Withdrawal{
		ID: uuid.New(), AccountID: accountID, Amount: amount, Destination: destination,
		Chain: chain, Status: domain.WithdrawalPending, RequiredSigs: w.required,
		Metadata: map[string]any{"idem": idemKey}, CreatedAt: now, UpdatedAt: now,
	}
	if _, err := tx.Exec(ctx, `INSERT INTO wallet.withdrawals
		(id, account_id, amount, destination, chain, status, required_sigs, metadata, idempotency_key, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,'pending',$6,$7::jsonb,$8,$9,$9)`,
		wd.ID, accountID, amount, destination, chain, w.required, marshalOrEmpty(wd.Metadata), idemKey, now); err != nil {
		return nil, err
	}
	if err := insertWithdrawalOutbox(ctx, tx, "wallet.withdrawal.requested", wd.ID.String(), map[string]any{
		"withdrawal_id": wd.ID, "account_id": accountID, "amount": amount, "chain": chain, "destination": destination,
		"idempotency_key": idemKey,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return wd, nil
}

// Sign collects one signature under a row lock. The same signer is idempotent.
func (w *WithdrawalService) Sign(ctx context.Context, withdrawalID uuid.UUID, signerID string) (*domain.Withdrawal, error) {
	if w.signer == nil {
		return nil, errors.New("custody signer is not configured")
	}
	if signerID == "" {
		return nil, errors.New("signer id required")
	}
	if len(w.allowedSignerIDs) > 0 {
		if _, ok := w.allowedSignerIDs[signerID]; !ok {
			return nil, errors.New("signer id is not allowlisted")
		}
	}

	tx, err := w.svc.pg.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	wd, err := scanWithdrawal(tx.QueryRow(ctx, `SELECT id, account_id, amount, destination, chain, status, tx_hash, signers, required_sigs, metadata, created_at, updated_at
		FROM wallet.withdrawals WHERE id=$1 FOR UPDATE`, withdrawalID))
	if err != nil {
		return nil, err
	}
	if wd.Metadata == nil {
		wd.Metadata = map[string]any{}
	}
	if wd.Status != domain.WithdrawalPending && wd.Status != domain.WithdrawalSigning {
		return nil, fmt.Errorf("withdrawal cannot be signed from status: %s", wd.Status)
	}
	for _, s := range wd.Signers {
		if s == signerID {
			if err := tx.Commit(ctx); err != nil {
				return nil, err
			}
			return wd, nil
		}
	}

	canonical := fmt.Sprintf("%s|%s|%s|%d|%s", wd.ID, wd.AccountID, wd.Destination, wd.Amount, wd.Chain)
	h := sha256.Sum256([]byte(canonical))
	sig, err := w.signer.Sign(ctx, signerID, h[:])
	if err != nil {
		return nil, fmt.Errorf("sign: %w", err)
	}
	wd.Signers = append(wd.Signers, signerID)
	wd.Metadata["sigs"] = append([]string(nil), wd.Signers...)
	wd.Metadata["last_sig"] = hex.EncodeToString(sig)
	if len(wd.Signers) >= wd.RequiredSigs {
		wd.Status = domain.WithdrawalBroadcast
		txHash := sha256.Sum256(append(h[:], sig...))
		wd.TxHash = hex.EncodeToString(txHash[:])
	} else {
		wd.Status = domain.WithdrawalSigning
	}
	wd.UpdatedAt = time.Now().UTC()
	if _, err := tx.Exec(ctx, `UPDATE wallet.withdrawals
		SET signers=$1::text[], status=$2, tx_hash=$3, metadata=$4::jsonb, updated_at=$5
		WHERE id=$6 AND status IN ('pending','signing')`, wd.Signers, string(wd.Status), wd.TxHash, marshalOrEmpty(wd.Metadata), wd.UpdatedAt, wd.ID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return wd, nil
}

// Confirm is an idempotent state transition from broadcast to confirmed.
func (w *WithdrawalService) Confirm(ctx context.Context, withdrawalID uuid.UUID) error {
	tx, err := w.svc.pg.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var accountID uuid.UUID
	var amount int64
	var status string
	if err := tx.QueryRow(ctx, `SELECT account_id, amount, status FROM wallet.withdrawals WHERE id=$1 FOR UPDATE`, withdrawalID).
		Scan(&accountID, &amount, &status); err != nil {
		return err
	}
	if status == string(domain.WithdrawalConfirmed) {
		return tx.Commit(ctx)
	}
	if status != string(domain.WithdrawalBroadcast) {
		return fmt.Errorf("withdrawal cannot confirm from status %s", status)
	}
	result, err := tx.Exec(ctx, `UPDATE wallet.accounts SET pending=pending-$1, version=version+1, updated_at=now()
		WHERE id=$2 AND pending >= $1`, amount, accountID)
	if err != nil {
		return err
	}
	if result.RowsAffected() != 1 {
		return errors.New("pending balance is insufficient for confirmation")
	}
	if _, err := tx.Exec(ctx, `UPDATE wallet.withdrawals SET status='confirmed', updated_at=now()
			WHERE id=$1 AND status='broadcast'`, withdrawalID); err != nil {
		return err
	}
	if err := insertWithdrawalOutbox(ctx, tx, "wallet.withdrawal.confirmed", withdrawalID.String(), map[string]any{
		"withdrawal_id": withdrawalID, "account_id": accountID, "amount": amount,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// Cancel releases a reservation only before a broadcast exists. It is idempotent
// for an already-canceled aggregate and refuses unsafe post-broadcast release.
func (w *WithdrawalService) Cancel(ctx context.Context, withdrawalID uuid.UUID, reason string) (*domain.Withdrawal, error) {
	tx, err := w.svc.pg.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var accountID uuid.UUID
	var amount int64
	var status string
	if err := tx.QueryRow(ctx, `SELECT account_id, amount, status FROM wallet.withdrawals WHERE id=$1 FOR UPDATE`, withdrawalID).
		Scan(&accountID, &amount, &status); err != nil {
		return nil, err
	}
	if status == string(domain.WithdrawalCanceled) {
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return w.get(ctx, withdrawalID)
	}
	if status != string(domain.WithdrawalPending) && status != string(domain.WithdrawalSigning) {
		return nil, fmt.Errorf("withdrawal cannot cancel from status %s", status)
	}
	result, err := tx.Exec(ctx, `UPDATE wallet.accounts SET available=available+$1, pending=pending-$1, version=version+1, updated_at=now()
		WHERE id=$2 AND pending >= $1`, amount, accountID)
	if err != nil {
		return nil, err
	}
	if result.RowsAffected() != 1 {
		return nil, errors.New("pending balance is insufficient for cancellation")
	}
	if _, err := tx.Exec(ctx, `UPDATE wallet.withdrawals SET status='canceled', metadata=COALESCE(metadata,'{}'::jsonb) || jsonb_build_object('cancel_reason',$2::text), updated_at=now()
		WHERE id=$1 AND status IN ('pending','signing')`, withdrawalID, reason); err != nil {
		return nil, err
	}
	if err := insertWithdrawalOutbox(ctx, tx, "wallet.withdrawal.canceled", withdrawalID.String(), map[string]any{
		"withdrawal_id": withdrawalID, "account_id": accountID, "amount": amount, "reason": reason,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return w.get(ctx, withdrawalID)
}

func insertWithdrawalOutbox(ctx context.Context, tx pgx.Tx, eventType, aggregateID string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	hash := sha256.Sum256(raw)
	_, err = tx.Exec(ctx, `INSERT INTO shared.outbox
		(id, aggregate, aggregate_id, event_type, payload, payload_hash, source_service)
		VALUES ($1, 'wallet', $2, $3, $4::jsonb, $5, 'wallet')`,
		uuid.New(), aggregateID, eventType, raw, hash[:])
	return err
}

func (w *WithdrawalService) get(ctx context.Context, id uuid.UUID) (*domain.Withdrawal, error) {
	return scanWithdrawal(w.svc.pg.QueryRow(ctx, `SELECT id, account_id, amount, destination, chain, status, tx_hash, signers, required_sigs, metadata, created_at, updated_at
		FROM wallet.withdrawals WHERE id=$1`, id))
}

// scanWithdrawal centralizes JSON decoding so every read has identical semantics.
func scanWithdrawal(row pgx.Row) (*domain.Withdrawal, error) {
	var wd domain.Withdrawal
	var meta []byte
	var txHash *string
	if err := row.Scan(&wd.ID, &wd.AccountID, &wd.Amount, &wd.Destination, &wd.Chain, &wd.Status, &txHash, &wd.Signers, &wd.RequiredSigs, &meta, &wd.CreatedAt, &wd.UpdatedAt); err != nil {
		return nil, err
	}
	if txHash != nil {
		wd.TxHash = *txHash
	}
	wd.Metadata = map[string]any{}
	if len(meta) > 0 {
		if err := json.Unmarshal(meta, &wd.Metadata); err != nil {
			return nil, fmt.Errorf("decode withdrawal metadata: %w", err)
		}
	}
	return &wd, nil
}
