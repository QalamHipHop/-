package ledger

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/rial/wallet-service/internal/domain"
)

type TradeSettlementParams struct {
	BuyerID        uuid.UUID
	SellerID       uuid.UUID
	Notional       int64
	BuyerFee       int64
	SellerFee      int64
	Reference      string
	IdempotencyKey string
	Metadata       map[string]any
}

// SettleReservedTrade captures the buyer's pending RIAL escrow and distributes
// the exact balanced amount to seller proceeds and treasury fees. Token-side
// settlement is owned by the token ledger; this method is the authoritative
// quote-currency leg.
func (s *Service) SettleReservedTrade(ctx context.Context, p TradeSettlementParams) (*domain.Transaction, error) {
	if p.BuyerID == uuid.Nil || p.SellerID == uuid.Nil || p.BuyerID == p.SellerID {
		return nil, errors.New("invalid trade parties")
	}
	if p.Notional <= 0 || p.BuyerFee < 0 || p.SellerFee < 0 {
		return nil, errors.New("invalid trade amounts")
	}
	const maxInt64 = int64(1<<63 - 1)
	if p.BuyerFee > maxInt64-p.SellerFee || p.Notional > maxInt64-p.BuyerFee {
		return nil, errors.New("trade amount overflow")
	}
	if p.IdempotencyKey == "" {
		return nil, errors.New("idempotency_key required")
	}
	buyer, err := s.GetOrCreateUserAccount(ctx, p.BuyerID)
	if err != nil {
		return nil, err
	}
	seller, err := s.GetOrCreateUserAccount(ctx, p.SellerID)
	if err != nil {
		return nil, err
	}
	treasury, err := s.EnsureInternalAccount(ctx, domain.AccountTreasury)
	if err != nil {
		return nil, err
	}
	ids := []uuid.UUID{buyer.ID, seller.ID, treasury.ID}
	sort.Slice(ids, func(i, j int) bool { return ids[i].String() < ids[j].String() })
	tx, err := s.pg.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.Serializable})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var priorID uuid.UUID
	var priorAmount int64
	var priorRef string
	var priorType string
	var priorBalance int64
	var priorAt time.Time
	if err := tx.QueryRow(ctx, `SELECT id, amount, reference, type, balance_after, created_at FROM wallet.transactions WHERE account_id=$1 AND idempotency_key=$2`, buyer.ID, p.IdempotencyKey).Scan(&priorID, &priorAmount, &priorRef, &priorType, &priorBalance, &priorAt); err == nil {
		if priorType == string(domain.TxTrade) && priorRef == p.Reference {
			return &domain.Transaction{ID: priorID, AccountID: buyer.ID, Type: domain.TxTrade, Amount: priorAmount, BalanceAfter: priorBalance, Reference: priorRef, IdempotencyKey: p.IdempotencyKey, CreatedAt: priorAt}, tx.Commit(ctx)
		}
		return nil, ErrIdempotencyClash
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	type row struct{ balance, available, pending, version int64 }
	states := map[uuid.UUID]row{}
	for _, id := range ids {
		var st row
		if err := tx.QueryRow(ctx, `SELECT balance, available, pending, version FROM wallet.accounts WHERE id=$1 FOR UPDATE`, id).Scan(&st.balance, &st.available, &st.pending, &st.version); err != nil {
			return nil, err
		}
		states[id] = st
	}
	capture := p.Notional + p.BuyerFee
	sellerNet := p.Notional - p.SellerFee
	if sellerNet <= 0 {
		return nil, errors.New("seller proceeds consumed by fee")
	}
	if states[seller.ID].balance > maxInt64-sellerNet || states[treasury.ID].balance > maxInt64-p.BuyerFee-p.SellerFee {
		return nil, errors.New("balance overflow")
	}
	if states[buyer.ID].pending < capture {
		return nil, ErrInsufficient
	}
	b := states[buyer.ID]
	b.pending -= capture
	b.balance -= capture
	b.version++
	sellerState := states[seller.ID]
	sellerState.available += sellerNet
	sellerState.balance += sellerNet
	sellerState.version++
	t := states[treasury.ID]
	t.available += p.BuyerFee + p.SellerFee
	t.balance += p.BuyerFee + p.SellerFee
	t.version++
	states[buyer.ID], states[seller.ID], states[treasury.ID] = b, sellerState, t
	for _, id := range ids {
		st := states[id]
		if _, err := tx.Exec(ctx, `UPDATE wallet.accounts SET balance=$1, available=$2, pending=$3, version=$4, updated_at=now() WHERE id=$5`, st.balance, st.available, st.pending, st.version, id); err != nil {
			return nil, err
		}
	}
	meta := p.Metadata
	if meta == nil {
		meta = map[string]any{}
	}
	metaBytes, _ := jsonMarshal(meta)
	created := time.Now().UTC()
	buyerTx := uuid.New()
	entries := []struct {
		id     uuid.UUID
		typ    domain.TransactionType
		amount int64
		bal    int64
		actor  string
	}{
		{buyer.ID, domain.TxTrade, -capture, b.balance, p.BuyerID.String()},
		{seller.ID, domain.TxTrade, sellerNet, sellerState.balance, p.SellerID.String()},
		{treasury.ID, domain.TxFee, p.BuyerFee + p.SellerFee, t.balance, "system"},
	}
	for i, e := range entries {
		txID := buyerTx
		if i > 0 {
			txID = uuid.New()
		}
		key := p.IdempotencyKey
		if i > 0 {
			key = p.IdempotencyKey + fmt.Sprintf(":%d", i)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO wallet.transactions (id, account_id, type, amount, balance_after, reference, metadata, actor, idempotency_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`, txID, e.id, string(e.typ), e.amount, e.bal, p.Reference, metaBytes, e.actor, key, created); err != nil {
			return nil, err
		}
		payload, _ := jsonMarshal(map[string]any{"transaction_id": txID, "account_id": e.id, "type": e.typ, "amount": e.amount, "balance_after": e.bal, "reference": p.Reference})
		if err := s.writeLedgerOutboxAndAudit(ctx, tx, e.id, e.typ, payload, CreditParams{Amount: e.amount, Reference: p.Reference, Metadata: meta, Actor: e.actor, IdempotencyKey: p.IdempotencyKey}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	_ = s.rds.Del(ctx, balanceKey(buyer.ID), balanceKey(seller.ID), balanceKey(treasury.ID)).Err()
	return &domain.Transaction{ID: buyerTx, AccountID: buyer.ID, Type: domain.TxTrade, Amount: -capture, BalanceAfter: b.balance, Reference: p.Reference, IdempotencyKey: p.IdempotencyKey, CreatedAt: created}, nil
}

func (s *Service) writeLedgerOutboxAndAudit(ctx context.Context, tx pgx.Tx, accountID uuid.UUID, typ domain.TransactionType, payload []byte, p CreditParams) error {
	payloadHash := sha256.Sum256(payload)
	prevHash := s.lastHash(ctx, tx, accountID)
	linked := sha256.Sum256(append(prevHash, payloadHash[:]...))
	if _, err := tx.Exec(ctx, `INSERT INTO shared.outbox (id, aggregate, aggregate_id, event_type, payload, payload_hash, prev_hash, source_service) VALUES ($1,'wallet',$2,$3,$4::jsonb,$5,$6,'wallet')`, uuid.New(), accountID.String(), "wallet."+string(typ), payload, payloadHash[:], linked[:]); err != nil {
		return err
	}
	p.AccountID = accountID
	p.Type = typ
	return s.writeAudit(ctx, tx, p, payloadHash[:], linked[:])
}
