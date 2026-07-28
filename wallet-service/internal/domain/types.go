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
	AccountUser    AccountKind = "user"
	AccountHot     AccountKind = "hot"
	AccountCold    AccountKind = "cold"
	AccountReserve AccountKind = "reserve"
	AccountTreasury AccountKind = "treasury"
	AccountEscrow  AccountKind = "escrow"
)

type Account struct {
	ID        uuid.UUID
	OwnerID   *uuid.UUID  // null for internal accounts
	Kind      AccountKind
	Symbol    string      // RIAL
	Balance   int64       // available + pending
	Available int64       // spendable right now
	Pending   int64       // locked (orders, withdrawals)
	Version   int64       // optimistic lock
	CreatedAt time.Time
	UpdatedAt time.Time
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
)

type Transaction struct {
	ID          uuid.UUID
	AccountID   uuid.UUID
	Type        TransactionType
	Amount      int64       // signed: +credit, -debit
	BalanceAfter int64
	Reference   string      // external id (order id, deposit id, etc.)
	Metadata    map[string]any
	Actor       string      // user id or "system"
	IdempotencyKey string
	CreatedAt   time.Time
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
	ID          uuid.UUID
	AccountID   uuid.UUID
	Amount      int64
	Destination string      // chain address
	Chain       string      // evm | solana | btc | iban
	Status      WithdrawalStatus
	TxHash      string
	Signers     []string    // collected signatures
	RequiredSigs int
	Metadata    map[string]any
	CreatedAt   time.Time
	UpdatedAt   time.Time
}
