package ledger

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type WithdrawalDestination struct {
	ID            uuid.UUID  `json:"id"`
	AccountID     uuid.UUID  `json:"account_id"`
	Chain         string     `json:"chain"`
	Destination   string     `json:"destination"`
	Label         string     `json:"label,omitempty"`
	Status        string     `json:"status"`
	CooldownUntil *time.Time `json:"cooldown_until,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	ActivatedAt   *time.Time `json:"activated_at,omitempty"`
	RevokedAt     *time.Time `json:"revoked_at,omitempty"`
}

// CreateWithdrawalDestination creates a pending destination and returns a one-time
// confirmation token. The token must be delivered through an authenticated gateway
// channel; it is never persisted in plaintext.
func (s *Service) CreateWithdrawalDestination(ctx context.Context, accountID uuid.UUID, chain, destination, label string, confirmationTTL time.Duration) (*WithdrawalDestination, string, error) {
	if accountID == uuid.Nil || chain == "" || destination == "" {
		return nil, "", errors.New("account, chain and destination are required")
	}
	if confirmationTTL <= 0 {
		confirmationTTL = 15 * time.Minute
	}
	id := uuid.New()
	randomToken := make([]byte, 32)
	if _, err := rand.Read(randomToken); err != nil {
		return nil, "", err
	}
	token := hex.EncodeToString(randomToken)
	hash := sha256.Sum256([]byte(token))
	expires := time.Now().UTC().Add(confirmationTTL)
	created := time.Now().UTC()

	row := &WithdrawalDestination{ID: id, AccountID: accountID, Chain: chain, Destination: destination, Label: label, Status: "pending", CreatedAt: created}
	payload, _ := json.Marshal(map[string]any{"destination_id": id, "account_id": accountID, "chain": chain})
	payloadHash := sha256.Sum256(payload)

	tx, err := s.pg.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, "", err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `INSERT INTO wallet.withdrawal_destinations
		(id, account_id, chain, destination, label, status, confirmation_token_hash, confirmation_expires_at, created_at)
		VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8)`, id, accountID, chain, destination, label, hash[:], expires, created); err != nil {
		return nil, "", err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO shared.outbox (aggregate, aggregate_id, event_type, payload, payload_hash)
		VALUES ($1,$2,$3,$4::jsonb,$5)`, "withdrawal_destination", id.String(), "wallet.withdrawal_destination.created", payload, payloadHash[:]); err != nil {
		return nil, "", err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, "", err
	}
	return row, token, nil
}

func (s *Service) ConfirmWithdrawalDestination(ctx context.Context, accountID, destinationID uuid.UUID, token string, cooldown time.Duration) error {
	if token == "" {
		return errors.New("confirmation token is required")
	}
	if cooldown <= 0 {
		cooldown = 24 * time.Hour
	}
	hash := sha256.Sum256([]byte(token))
	now := time.Now().UTC()
	tx, err := s.pg.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var stored []byte
	var status string
	var expires *time.Time
	if err = tx.QueryRow(ctx, `SELECT confirmation_token_hash, status, confirmation_expires_at
		FROM wallet.withdrawal_destinations WHERE id=$1 AND account_id=$2 FOR UPDATE`, destinationID, accountID).Scan(&stored, &status, &expires); err != nil {
		return err
	}
	if status != "pending" || expires == nil || now.After(*expires) || !equalBytes(stored, hash[:]) {
		return ErrDestinationNotWhitelisted
	}
	cooldownUntil := now.Add(cooldown)
	if _, err = tx.Exec(ctx, `UPDATE wallet.withdrawal_destinations
		SET status='active', activated_at=$3, cooldown_until=$4, confirmation_token_hash=NULL, confirmation_expires_at=NULL
		WHERE id=$1 AND account_id=$2`, destinationID, accountID, now, cooldownUntil); err != nil {
		return err
	}
	payload, _ := json.Marshal(map[string]any{"destination_id": destinationID, "account_id": accountID, "cooldown_until": cooldownUntil})
	payloadHash := sha256.Sum256(payload)
	if _, err = tx.Exec(ctx, `INSERT INTO shared.outbox (aggregate, aggregate_id, event_type, payload, payload_hash)
		VALUES ($1,$2,$3,$4::jsonb,$5)`, "withdrawal_destination", destinationID.String(), "wallet.withdrawal_destination.confirmed", payload, payloadHash[:]); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) RevokeWithdrawalDestination(ctx context.Context, accountID, destinationID uuid.UUID) error {
	tx, err := s.pg.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `UPDATE wallet.withdrawal_destinations
		SET status='revoked', revoked_at=now(), confirmation_token_hash=NULL, confirmation_expires_at=NULL
		WHERE id=$1 AND account_id=$2 AND status <> 'revoked'`, destinationID, accountID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	payload, _ := json.Marshal(map[string]any{"destination_id": destinationID, "account_id": accountID})
	payloadHash := sha256.Sum256(payload)
	if _, err = tx.Exec(ctx, `INSERT INTO shared.outbox (aggregate, aggregate_id, event_type, payload, payload_hash)
		VALUES ($1,$2,$3,$4::jsonb,$5)`, "withdrawal_destination", destinationID.String(), "wallet.withdrawal_destination.revoked", payload, payloadHash[:]); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Service) ListWithdrawalDestinations(ctx context.Context, accountID uuid.UUID) ([]WithdrawalDestination, error) {
	if accountID == uuid.Nil {
		return nil, errors.New("account is required")
	}
	rows, err := s.pg.Query(ctx, `SELECT id, account_id, chain, destination, label, status, cooldown_until, created_at, activated_at, revoked_at
		FROM wallet.withdrawal_destinations WHERE account_id=$1 ORDER BY created_at DESC`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]WithdrawalDestination, 0)
	for rows.Next() {
		var item WithdrawalDestination
		if err := rows.Scan(&item.ID, &item.AccountID, &item.Chain, &item.Destination, &item.Label, &item.Status, &item.CooldownUntil, &item.CreatedAt, &item.ActivatedAt, &item.RevokedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func equalBytes(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	var diff byte
	for i := range a {
		diff |= a[i] ^ b[i]
	}
	return diff == 0
}
