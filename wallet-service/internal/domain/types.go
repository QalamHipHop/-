// Package domain holds pure types — no IO. Money is always bigint minor units (8 dp).
package domain

import (
	"time"

	"github.com/google/uuid"
)

// AccountKind classifies accounts. Internal accounts (reserve, treasury)
// hold platform funds; user accounts hold user funds; escrow holds in-flight
// trade / launch proceeds.
type AccountKind string

const (
	AccountUser     AccountKind = "user"
	AccountHot      AccountKind = "hot"
	AccountCold     AccountKind = "cold"
	AccountReserve  AccountKind = "reserve"
	AccountTreasury AccountKind = "treasury"
	AccountEscrow   AccountKind = "escrow"
)

type Account struct {
	ID        uuid.UUID   `json:"id"`
	OwnerID   *uuid.UUID  `json:"owner_id,omitempty"` // null for internal
	Kind      AccountKind `json:"kind"`
	Symbol    string      `json:"symbol"`           // RIAL
	Balance   int64       `json:"balance,string"`   // available + pending
	Available int64       `json:"available,string"` // spendable right now
	Pending   int64       `json:"pending,string"`   // locked (orders, withdrawals)
	Version   int64       `json:"version,string"`   // optimistic lock
	CreatedAt time.Time   `json:"created_at"`
	UpdatedAt time.Time   `json:"updated_at"`
}

// TransactionType classifies ledger entries.
type TransactionType string

const (
	TxDeposit    TransactionType = "deposit"
	TxWithdraw   TransactionType = "withdraw"
	TxTrade      TransactionType = "trade"
	TxFee        TransactionType = "fee"
	TxReward     TransactionType = "reward"
	TxRefund     TransactionType = "refund"
	TxTransfer   TransactionType = "transfer"
	TxAdjustment TransactionType = "adjustment"
	TxReserve    TransactionType = "reserve"
	TxRelease    TransactionType = "release"
)

type Transaction struct {
	ID             uuid.UUID       `json:"id"`
	AccountID      uuid.UUID       `json:"account_id"`
	Type           TransactionType `json:"type"`
	Amount         int64           `json:"amount,string"` // signed: +credit, -debit
	BalanceAfter   int64           `json:"balance_after,string"`
	Reference      string          `json:"reference"` // external id (order id, deposit id, etc.)
	Metadata       map[string]any  `json:"metadata"`
	Actor          string          `json:"actor"` // user id or "system"
	IdempotencyKey string          `json:"idempotency_key"`
	CreatedAt      time.Time       `json:"created_at"`
}

// WithdrawalStatus tracks lifecycle of a withdrawal.
type WithdrawalStatus string

const (
	WithdrawalPending   WithdrawalStatus = "pending"
	WithdrawalSigning   WithdrawalStatus = "signing"
	WithdrawalBroadcast WithdrawalStatus = "broadcast"
	WithdrawalConfirmed WithdrawalStatus = "confirmed"
	WithdrawalFailed    WithdrawalStatus = "failed"
	WithdrawalCanceled  WithdrawalStatus = "canceled"
)

type Withdrawal struct {
	ID           uuid.UUID
	AccountID    uuid.UUID
	Amount       int64
	Destination  string // chain address
	Chain        string // evm | solana | btc | iban
	Status       WithdrawalStatus
	TxHash       string
	Signers      []string // collected signatures
	RequiredSigs int
	Metadata     map[string]any
	CreatedAt    time.Time
	UpdatedAt    time.Time
}
