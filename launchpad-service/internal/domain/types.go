// Package domain contains shared types across packages.
package domain

import (
	"time"

	"github.com/google/uuid"
)

type TokenStatus string

const (
	TokenDraft      TokenStatus = "draft"
	TokenPending    TokenStatus = "pending"
	TokenLive       TokenStatus = "live"
	TokenGraduated  TokenStatus = "graduated"
	TokenRejected   TokenStatus = "rejected"
	TokenPaused     TokenStatus = "paused"
)

type Token struct {
	ID                  uuid.UUID  `json:"id"`
	CreatorID           uuid.UUID  `json:"creator_id"`
	Chain               string     `json:"chain"`
	ContractAddress     string     `json:"contract_address"`
	Name                string     `json:"name"`
	Symbol              string     `json:"symbol"`
	Decimals            int        `json:"decimals"`
	TotalSupply         string     `json:"total_supply"`
	LogoURL             *string    `json:"logo_url,omitempty"`
	BannerURL           *string    `json:"banner_url,omitempty"`
	Description         *string    `json:"description,omitempty"`
	Website             *string    `json:"website,omitempty"`
	Telegram            *string    `json:"telegram,omitempty"`
	Twitter             *string    `json:"twitter,omitempty"`
	Discord             *string    `json:"discord,omitempty"`
	GitHub              *string    `json:"github,omitempty"`
	MintAuthority       *string    `json:"mint_authority,omitempty"`
	FreezeAuthority     *string    `json:"freeze_authority,omitempty"`
	CurveModel          string     `json:"curve_model"`
	CurveParams         []byte     `json:"curve_params"`
	GraduationRialMinor int64      `json:"graduation_rial_minor"`
	Graduated           bool       `json:"graduated"`
	GraduatedAt         *time.Time `json:"graduated_at,omitempty"`
	Status              TokenStatus `json:"status"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
}

type BondingState struct {
	TokenID                    uuid.UUID `json:"token_id"`
	SupplyCirculatingMinor     int64     `json:"supply_circulating_minor"`
	ReserveRialMinor           int64     `json:"reserve_rial_minor"`
	VirtualRialMinor           int64     `json:"virtual_rial_minor"`
	PriceRialPerTokenMinor8DP  string    `json:"price_rial_per_token_minor_8dp"`
	HoldersCount               int       `json:"holders_count"`
	UpdatedAt                  time.Time `json:"updated_at"`
}

type Holder struct {
	TokenID       uuid.UUID `json:"token_id"`
	UserID        uuid.UUID `json:"user_id"`
	BalanceMinor  int64     `json:"balance_minor"`
	FirstBoughtAt time.Time `json:"first_bought_at"`
}

type VestingSchedule struct {
	ID              uuid.UUID `json:"id"`
	TokenID         uuid.UUID `json:"token_id"`
	Beneficiary     uuid.UUID `json:"beneficiary"`
	TotalMinor      int64     `json:"total_minor"`
	ReleasedMinor   int64     `json:"released_minor"`
	CliffSeconds    int       `json:"cliff_seconds"`
	DurationSeconds int       `json:"duration_seconds"`
	StartAt         time.Time `json:"start_at"`
	CreatedAt       time.Time `json:"created_at"`
}

type RiskScore struct {
	UserID     uuid.UUID              `json:"user_id"`
	Score      float64                `json:"score"`
	Components map[string]float64     `json:"components"`
	UpdatedAt  time.Time              `json:"updated_at"`
	Raw        map[string]interface{} `json:"raw,omitempty"`
}

type BuyQuote struct {
	Token             Token        `json:"token"`
	AmountInMinor     int64        `json:"amount_in_minor"`
	AmountOutMinor    int64        `json:"amount_out_minor"`
	FeeMinor          int64        `json:"fee_minor"`
	PriceImpactBps    int          `json:"price_impact_bps"`
	NewReserveMinor   int64        `json:"new_reserve_minor"`
	NewSupplyMinor    int64        `json:"new_supply_minor"`
	NewPrice          string       `json:"new_price"`
	WillGraduate      bool         `json:"will_graduate"`
}

type BuyResult struct {
	Quote      BuyQuote        `json:"quote"`
	TradeID    uuid.UUID       `json:"trade_id"`
	TxHash     string          `json:"tx_hash"`
	NewBonding BondingState    `json:"new_bonding"`
	NewHolder  Holder          `json:"new_holder"`
	ExecutedAt time.Time       `json:"executed_at"`
}
