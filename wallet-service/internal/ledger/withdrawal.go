package ledger

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/rial/wallet-service/internal/custody"
	"github.com/rial/wallet-service/internal/domain"
)

// WithdrawalService — orchestrates multi-sig withdrawals.
type WithdrawalService struct {
	svc      *Service
	signer   custody.Signer
	required int
}

func NewWithdrawalService(svc *Service, signer custody.Signer, required int) *WithdrawalService {
	return &WithdrawalService{svc: svc, signer: signer, required: required}
}

// Request creates a withdrawal, debits available -> pending, and returns the row.
func (w *WithdrawalService) Request(ctx context.Context, accountID uuid.UUID, amount int64, chain, destination, idemKey string) (*domain.Withdrawal, error) {
	if amount <= 0 { return nil, ErrNegativeAmount }
	if destination == "" { return nil, errors.New("destination required") }

	tx, err := w.svc.pg.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil { return nil, err }
	defer tx.Rollback(ctx)

	// move available -> pending atomically
	var balance, available, pending, version int64
	if err := tx.QueryRow(ctx, `SELECT balance, available, pending, version FROM wallet.accounts WHERE id=$1 FOR UPDATE`, accountID).
		Scan(&balance, &available, &pending, &version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) { return nil, ErrAccountNotFound }
		return nil, err
	}
	if available < amount { return nil, ErrInsufficient }

	if _, err := tx.Exec(ctx, `UPDATE wallet.accounts SET available = available - $1, pending = pending + $1, version = version + 1, updated_at = now() WHERE id = $2 AND version = $3`,
		amount, accountID, version); err != nil {
		return nil, err
	}

	wd := &domain.Withdrawal{
		ID: uuid.New(), AccountID: accountID, Amount: amount, Destination: destination,
		Chain: chain, Status: domain.WithdrawalPending, RequiredSigs: w.required,
		Metadata: map[string]any{"idem": idemKey}, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	if _, err := tx.Exec(ctx, `INSERT INTO wallet.withdrawals (id, account_id, amount, destination, chain, status, required_sigs, metadata, created_at, updated_at)
		VALUES ($1,$2,$3,$4,$5,'pending',$6,$7::jsonb,$8,$8)`,
		wd.ID, accountID, amount, destination, chain, w.required, marshalOrEmpty(wd.Metadata), wd.CreatedAt); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil { return nil, err }
	return wd, nil
}

// Sign collects one signature; auto-broadcasts once threshold is reached.
func (w *WithdrawalService) Sign(ctx context.Context, withdrawalID uuid.UUID, signerID string) (*domain.Withdrawal, error) {
	wd, err := w.get(ctx, withdrawalID)
	if err != nil { return nil, err }
	if wd.Status != domain.WithdrawalPending {
		return nil, fmt.Errorf("withdrawal not pending: %s", wd.Status)
	}
	for _, s := range wd.Signers { if s == signerID { return wd, nil } } // idempotent

	// build the payload to sign (deterministic JSON of withdrawal)
	canonical := fmt.Sprintf("%s|%s|%s|%d|%s", wd.ID, wd.AccountID, wd.Destination, wd.Amount, wd.Chain)
	h := sha256.Sum256([]byte(canonical))
	sig, err := w.signer.Sign(ctx, signerID, h[:])
	if err != nil { return nil, fmt.Errorf("sign: %w", err) }

	wd.Signers = append(wd.Signers, signerID)
	wd.Metadata["sigs"] = append(wd.Signers, signerID)
	wd.Metadata["last_sig"] = hex.EncodeToString(sig)

	if len(wd.Signers) >= wd.RequiredSigs {
		wd.Status = domain.WithdrawalBroadcast
		txHash := sha256.Sum256(append(h[:], sig...))
		wd.TxHash = hex.EncodeToString(txHash[:])
	}
	wd.UpdatedAt = time.Now().UTC()
	if _, err := w.svc.pg.Exec(ctx, `UPDATE wallet.withdrawals SET signers = $1::text[], status = $2, tx_hash = $3, metadata = $4::jsonb, updated_at = $5 WHERE id = $6`,
		wd.Signers, string(wd.Status), wd.TxHash, marshalOrEmpty(wd.Metadata), wd.UpdatedAt, wd.ID); err != nil {
		return nil, err
	}
	return wd, nil
}

// Confirm moves pending -> 0 (settled) once on-chain confirmation observed.
func (w *WithdrawalService) Confirm(ctx context.Context, withdrawalID uuid.UUID) error {
	wd, err := w.get(ctx, withdrawalID)
	if err != nil { return err }
	tx, err := w.svc.pg.BeginTx(ctx, pgx.TxOptions{})
	if err != nil { return err }
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `UPDATE wallet.accounts SET pending = pending - $1, version = version + 1, updated_at = now() WHERE id = $2`, wd.Amount, wd.AccountID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `UPDATE wallet.withdrawals SET status = 'confirmed', updated_at = now() WHERE id = $1`, withdrawalID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (w *WithdrawalService) get(ctx context.Context, id uuid.UUID) (*domain.Withdrawal, error) {
	row := w.svc.pg.QueryRow(ctx, `SELECT id, account_id, amount, destination, chain, status, tx_hash, signers, required_sigs, metadata, created_at, updated_at
		FROM wallet.withdrawals WHERE id = $1`, id)
	var wd domain.Withdrawal
	var meta []byte
	if err := row.Scan(&wd.ID, &wd.AccountID, &wd.Amount, &wd.Destination, &wd.Chain, &wd.Status, &wd.TxHash, &wd.Signers, &wd.RequiredSigs, &meta, &wd.CreatedAt, &wd.UpdatedAt); err != nil {
		return nil, err
	}
	return &wd, nil
}
