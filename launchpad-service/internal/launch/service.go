// Package launch — token creation, buy/sell, vesting, AI risk.
package launch

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"github.com/rial/launchpad-service/internal/config"
	"github.com/rial/launchpad-service/internal/curve"
	"github.com/rial/launchpad-service/internal/domain"
	"github.com/rial/launchpad-service/internal/event"
	"github.com/rial/launchpad-service/internal/graduation"
	"github.com/rial/launchpad-service/internal/risk"
	"github.com/rial/launchpad-service/internal/store"
	"github.com/rial/launchpad-service/internal/wallet"
)

type Service struct {
	cfg    *config.Config
	pg     *store.PG
	rd     *store.RD
	nc     *event.Nats
	kc     *event.Kafka
	risk   *risk.Client
	wallet *wallet.Client
	curve  *curve.Engine
	grad   *graduation.Service
	log    *zap.Logger
}

func NewService(
	cfg *config.Config,
	pg *store.PG, rd *store.RD, nc *event.Nats, kc *event.Kafka,
	riskClient *risk.Client, walletClient *wallet.Client, curveEngine *curve.Engine,
	grad *graduation.Service, log *zap.Logger,
) *Service {
	return &Service{cfg: cfg, pg: pg, rd: rd, nc: nc, kc: kc, risk: riskClient, wallet: walletClient, curve: curveEngine, grad: grad, log: log}
}

// CreateTokenInput — validated externally.
type CreateTokenInput struct {
	Name                string
	Symbol              string
	Decimals            int
	TotalSupply         string
	Chain               string
	ContractAddress     string
	LogoURL             string
	BannerURL           string
	Description         string
	Website             string
	Telegram            string
	Twitter             string
	Discord             string
	GitHub              string
	MintAuthority       string
	FreezeAuthority     string
	CurveModel          string
	CurveParams         json.RawMessage
	GraduationRialMinor int64
	Vesting             []VestingInput
}

type VestingInput struct {
	Beneficiary     string    `json:"beneficiary"`
	TotalMinor      int64     `json:"total_minor"`
	CliffSeconds    int       `json:"cliff_seconds"`
	DurationSeconds int       `json:"duration_seconds"`
	StartAt         time.Time `json:"start_at"`
}

func (s *Service) Create(ctx context.Context, creatorID uuid.UUID, in CreateTokenInput) (*domain.Token, error) {
	if s.isPlatformPaused(ctx) {
		return nil, errors.New("LAUNCHPAD_PAUSED: launchpad is temporarily paused")
	}
	if err := s.validateCreateInput(in); err != nil {
		return nil, err
	}

	// Model validation happens before the single durable creation transaction.
	model, err := curve.ParseModel(in.CurveModel)
	if err != nil {
		return nil, err
	}
	params := curve.DefaultParams()
	if len(in.CurveParams) > 0 {
		params, err = curve.DecodeParams(in.CurveParams)
		if err != nil {
			return nil, err
		}
	}
	if err := s.curve.Validate(model, params); err != nil {
		return nil, err
	}

	// AI risk gate
	if s.cfg.Launchpad.RiskAIEnabled {
		rs, err := s.risk.ScoreToken(ctx, risk.TokenInput{
			Name: in.Name, Symbol: in.Symbol, Description: in.Description,
			Website: in.Website, Telegram: in.Telegram, Twitter: in.Twitter, LogoURL: in.LogoURL,
		})
		if err != nil {
			if s.cfg.Launchpad.RiskFailClosed || strings.EqualFold(s.cfg.Env, "production") {
				return nil, fmt.Errorf("RISK_UNAVAILABLE: token risk gate failed: %w", err)
			}
			s.log.Warn("risk ai failed in non-production; policy allows continuation", zap.Error(err))
		} else if rs == nil || math.IsNaN(rs.Score) || math.IsInf(rs.Score, 0) || rs.Score < 0 || rs.Score > 1 {
			return nil, errors.New("RISK_INVALID: token risk response is invalid")
		} else if rs.Score > 0.85 {
			return nil, fmt.Errorf("RISK_REJECTED: token failed AI risk gate (score=%.2f)", rs.Score)
		}
	}

	id := uuid.New()
	t := &domain.Token{
		ID: id, CreatorID: creatorID, Chain: in.Chain, ContractAddress: in.ContractAddress,
		Name: in.Name, Symbol: strings.ToUpper(in.Symbol), Decimals: in.Decimals, TotalSupply: in.TotalSupply,
		LogoURL: nilIfEmpty(in.LogoURL), BannerURL: nilIfEmpty(in.BannerURL), Description: nilIfEmpty(in.Description),
		Website: nilIfEmpty(in.Website), Telegram: nilIfEmpty(in.Telegram), Twitter: nilIfEmpty(in.Twitter),
		Discord: nilIfEmpty(in.Discord), GitHub: nilIfEmpty(in.GitHub),
		MintAuthority: nilIfEmpty(in.MintAuthority), FreezeAuthority: nilIfEmpty(in.FreezeAuthority),
		CurveModel: string(model), CurveParams: curve.EncodeParams(params),
		GraduationRialMinor: in.GraduationRialMinor, Status: domain.TokenPending,
	}
	vesting := make([]*domain.VestingSchedule, 0, len(in.Vesting))
	for _, v := range in.Vesting {
		ben, err := uuid.Parse(v.Beneficiary)
		if err != nil {
			return nil, fmt.Errorf("INVALID_VESTING_BENEFICIARY: %w", err)
		}
		if v.TotalMinor <= 0 || v.CliffSeconds < 0 || v.DurationSeconds <= 0 || v.StartAt.IsZero() {
			return nil, errors.New("INVALID_VESTING_SCHEDULE")
		}
		vesting = append(vesting, &domain.VestingSchedule{
			ID:              uuid.New(),
			TokenID:         id,
			Beneficiary:     ben,
			TotalMinor:      v.TotalMinor,
			CliffSeconds:    v.CliffSeconds,
			DurationSeconds: v.DurationSeconds,
			StartAt:         v.StartAt,
		})
	}
	if err := s.pg.CreateTokenWithInitialState(ctx, t, params.VirtualRial, vesting, s.cfg.Launchpad.MaxTokensPerCreator); err != nil {
		return nil, err
	}

	// publish & audit
	s.nc.Publish(ctx, "launchpad.token.created", map[string]any{"token_id": id.String(), "creator": creatorID.String()})
	s.kc.Audit(ctx, id.String(), map[string]any{"event": "token.created", "token_id": id.String()})
	return t, nil
}

func (s *Service) Approve(ctx context.Context, adminID, tokenID uuid.UUID) error {
	tk, err := s.pg.GetToken(ctx, tokenID)
	if err != nil {
		return err
	}
	if tk.Status == domain.TokenGraduated {
		return errors.New("ALREADY_GRADUATED")
	}
	if err := s.pg.UpdateTokenStatus(ctx, tokenID, string(domain.TokenLive)); err != nil {
		return err
	}
	s.nc.Publish(ctx, "launchpad.token.approved", map[string]any{"token_id": tokenID.String(), "by": adminID.String()})
	return nil
}

func (s *Service) Reject(ctx context.Context, adminID, tokenID uuid.UUID, reason string) error {
	if err := s.pg.UpdateTokenStatus(ctx, tokenID, string(domain.TokenRejected)); err != nil {
		return err
	}
	s.nc.Publish(ctx, "launchpad.token.rejected", map[string]any{"token_id": tokenID.String(), "by": adminID.String(), "reason": reason})
	return nil
}

func (s *Service) Pause(ctx context.Context, adminID, tokenID uuid.UUID, reason string) error {
	if err := s.pg.UpdateTokenStatus(ctx, tokenID, string(domain.TokenPaused)); err != nil {
		return err
	}
	s.nc.Publish(ctx, "launchpad.token.paused", map[string]any{"token_id": tokenID.String(), "by": adminID.String(), "reason": reason})
	return nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (*domain.Token, error) {
	return s.pg.GetToken(ctx, id)
}

func (s *Service) List(ctx context.Context, status string, limit, offset int) ([]*domain.Token, error) {
	return s.pg.ListTokens(ctx, status, limit, offset)
}

// ---- buy / sell ----

func (s *Service) QuoteBuy(ctx context.Context, tokenID uuid.UUID, rialInMinor int64) (*domain.BuyQuote, error) {
	if s.isPlatformPaused(ctx) {
		return nil, errors.New("LAUNCHPAD_PAUSED: launchpad is temporarily paused")
	}
	tk, st, err := s.tokenAndState(ctx, tokenID)
	if err != nil {
		return nil, err
	}
	if tk.Status != domain.TokenLive {
		return nil, errors.New("TOKEN_NOT_LIVE")
	}
	model := curve.Model(tk.CurveModel)
	cs := &curve.State{SupplyMinor: st.SupplyCirculatingMinor, ReserveMinor: st.ReserveRialMinor, VirtualMinor: st.VirtualRialMinor, Params: curve.MustParams(tk.CurveParams)}
	out, fee, newSup, newRes, err := s.curve.QuoteBuy(cs, model, rialInMinor)
	if err != nil {
		return nil, err
	}
	newPrice, err := cs.SpotPriceFor(model, newSup)
	if err != nil {
		return nil, err
	}
	willGrad := (newRes + cs.VirtualMinor) >= tk.GraduationRialMinor
	return &domain.BuyQuote{
		Token: *tk, AmountInMinor: rialInMinor, AmountOutMinor: out, FeeMinor: fee,
		PriceImpactBps:  int(priceImpactBps(cs, model, rialInMinor)),
		NewReserveMinor: newRes, NewSupplyMinor: newSup,
		NewPrice:     strconv.FormatFloat(newPrice, 'f', 8, 64),
		WillGraduate: willGrad,
	}, nil
}

func (s *Service) Buy(ctx context.Context, userID, tokenID uuid.UUID, rialInMinor int64, clientID string) (*domain.BuyResult, error) {
	if s.isPlatformPaused(ctx) {
		return nil, errors.New("LAUNCHPAD_PAUSED: launchpad is temporarily paused")
	}
	if strings.TrimSpace(clientID) == "" {
		return nil, errors.New("CLIENT_ID_REQUIRED")
	}
	tk, st, err := s.tokenAndState(ctx, tokenID)
	if err != nil {
		return nil, err
	}
	if tk.Status != domain.TokenLive {
		return nil, errors.New("TOKEN_NOT_LIVE")
	}

	// idempotency by clientID
	if clientID != "" {
		// we keep it simple: rely on trading service for client-side dedup
	}

	// AI sanity check on buyer. In production, a missing or malformed risk
	// decision is a hard deny; silently ignoring it would be fail-open.
	if s.cfg.Launchpad.RiskAIEnabled {
		rs, riskErr := s.risk.ScoreUser(ctx, userID.String())
		if riskErr != nil {
			if s.cfg.Launchpad.RiskFailClosed || strings.EqualFold(s.cfg.Env, "production") {
				return nil, fmt.Errorf("RISK_UNAVAILABLE: buyer risk gate failed: %w", riskErr)
			}
			s.log.Warn("buyer risk check failed in non-production", zap.Error(riskErr))
		} else if rs == nil || math.IsNaN(rs.Score) || math.IsInf(rs.Score, 0) || rs.Score < 0 || rs.Score > 1 {
			return nil, errors.New("RISK_INVALID: buyer risk response is invalid")
		} else if rs.Score > 0.85 {
			return nil, fmt.Errorf("RISK_REJECTED: buyer failed risk gate (score=%.2f)", rs.Score)
		}
	}

	model := curve.Model(tk.CurveModel)
	cs := &curve.State{SupplyMinor: st.SupplyCirculatingMinor, ReserveMinor: st.ReserveRialMinor, VirtualMinor: st.VirtualRialMinor, Params: curve.MustParams(tk.CurveParams)}
	out, fee, newSup, newRes, err := s.curve.QuoteBuy(cs, model, rialInMinor)
	if err != nil {
		return nil, err
	}
	if out == 0 {
		return nil, errors.New("ZERO_OUTPUT")
	}

	// Settlement must be recorded in the wallet ledger before ownership changes.
	// The key is deterministic, so a client retry cannot debit the same order twice.
	release, err := s.rd.AcquireLock(ctx, "buy:"+tokenID.String(), 5*time.Second)
	if err != nil {
		return nil, err
	}
	defer func() { _ = release() }()

	requestID := "buy:" + clientID
	if existing, found, err := s.pg.GetTradeRequest(ctx, tokenID, userID, requestID); err != nil {
		return nil, err
	} else if found {
		return existing, nil
	}

	tradeID := uuid.New()
	settlementKey := settlementKey("buy", tokenID, userID, clientID)
	settlementRef := "launchpad-buy:" + tradeID.String()
	settlementMeta := map[string]any{
		"token_id": tokenID.String(), "trade_id": tradeID.String(),
		"token_out_minor": out, "fee_minor": fee,
	}
	walletTxID, err := s.wallet.Debit(ctx, userID.String(), rialInMinor, settlementRef, settlementKey, settlementMeta)
	if err != nil {
		return nil, fmt.Errorf("SETTLEMENT_DEBIT_FAILED: %w", err)
	}

	// The gross debit is split into redeemable curve liquidity and a treasury fee.
	// Every leg has a deterministic idempotency key so compensation is retry-safe.
	netReserve := rialInMinor - fee
	reserveCredited, treasuryCredited := false, false
	if _, err := s.wallet.CreditReserve(ctx, netReserve, settlementRef, "reserve-"+settlementKey, settlementMeta); err != nil {
		_, refundErr := s.wallet.Refund(ctx, userID.String(), rialInMinor, settlementRef, "refund-"+settlementKey, settlementMeta)
		if refundErr != nil {
			return nil, fmt.Errorf("%w; buyer refund failed: %v", err, refundErr)
		}
		return nil, fmt.Errorf("RESERVE_CREDIT_FAILED: %w", err)
	}
	reserveCredited = true
	if fee > 0 {
		if _, err := s.wallet.CreditTreasury(ctx, fee, settlementRef, "treasury-"+settlementKey, settlementMeta); err != nil {
			_, reserveErr := s.wallet.DebitReserve(ctx, netReserve, settlementRef, "reserve-reversal-"+settlementKey, settlementMeta)
			_, refundErr := s.wallet.Refund(ctx, userID.String(), rialInMinor, settlementRef, "refund-"+settlementKey, settlementMeta)
			if reserveErr != nil || refundErr != nil {
				return nil, fmt.Errorf("%w; fee compensation failed reserve=%v refund=%v", err, reserveErr, refundErr)
			}
			return nil, fmt.Errorf("TREASURY_CREDIT_FAILED: %w", err)
		}
		treasuryCredited = true
	}
	refund := func(cause error) error {
		var rollbackErrs []error
		if treasuryCredited {
			if _, err := s.wallet.DebitTreasury(ctx, fee, settlementRef, "treasury-reversal-"+settlementKey, settlementMeta); err != nil {
				rollbackErrs = append(rollbackErrs, err)
			}
		}
		if reserveCredited {
			if _, err := s.wallet.DebitReserve(ctx, netReserve, settlementRef, "reserve-reversal-"+settlementKey, settlementMeta); err != nil {
				rollbackErrs = append(rollbackErrs, err)
			}
		}
		if _, err := s.wallet.Refund(ctx, userID.String(), rialInMinor, settlementRef, "refund-"+settlementKey, settlementMeta); err != nil {
			rollbackErrs = append(rollbackErrs, err)
		}
		if len(rollbackErrs) > 0 {
			s.log.Error("wallet compensation after failed buy state update", zap.Errors("rollback_errors", rollbackErrs), zap.Error(cause), zap.String("trade_id", tradeID.String()))
			return fmt.Errorf("%w; settlement compensation failed: %v", cause, rollbackErrs)
		}
		return cause
	}

	newState := *st
	newState.SupplyCirculatingMinor = newSup
	newState.ReserveRialMinor = newRes
	res := &domain.BuyResult{
		Quote: domain.BuyQuote{
			Token: *tk, AmountInMinor: rialInMinor, AmountOutMinor: out, FeeMinor: fee,
			NewReserveMinor: newRes, NewSupplyMinor: newSup, WillGraduate: newRes+cs.VirtualMinor >= tk.GraduationRialMinor,
		},
		TradeID: tradeID, TxHash: walletTxID,
		NewBonding: newState, ExecutedAt: time.Now(),
	}
	if err := s.pg.ApplyTradeState(ctx, tokenID, userID, out, &newState, requestID, res); err != nil {
		if errors.Is(err, store.ErrTradeRequestExists) {
			if existing, found, getErr := s.pg.GetTradeRequest(ctx, tokenID, userID, requestID); getErr == nil && found {
				return existing, nil
			}
		}
		return nil, refund(err)
	}

	s.nc.Publish(ctx, "launchpad.buy", res)
	s.kc.Audit(ctx, tokenID.String(), res)

	if res.Quote.WillGraduate {
		// fire-and-forget — graduation service will pick this up
		s.grad.Notify(ctx, tokenID)
	}
	return res, nil
}

func (s *Service) Sell(ctx context.Context, userID, tokenID uuid.UUID, tokensInMinor int64, clientID string) (*domain.BuyResult, error) {
	if s.isPlatformPaused(ctx) {
		return nil, errors.New("LAUNCHPAD_PAUSED: launchpad is temporarily paused")
	}
	if strings.TrimSpace(clientID) == "" {
		return nil, errors.New("CLIENT_ID_REQUIRED")
	}
	tk, st, err := s.tokenAndState(ctx, tokenID)
	if err != nil {
		return nil, err
	}
	if tk.Status != domain.TokenLive {
		return nil, errors.New("TOKEN_NOT_LIVE")
	}
	model := curve.Model(tk.CurveModel)
	cs := &curve.State{SupplyMinor: st.SupplyCirculatingMinor, ReserveMinor: st.ReserveRialMinor, VirtualMinor: st.VirtualRialMinor, Params: curve.MustParams(tk.CurveParams)}
	out, fee, newSup, newRes, err := s.curve.QuoteSell(cs, model, tokensInMinor)
	if err != nil {
		return nil, err
	}
	if out <= 0 {
		return nil, errors.New("ZERO_OUTPUT")
	}
	release, err := s.rd.AcquireLock(ctx, "sell:"+tokenID.String(), 5*time.Second)
	if err != nil {
		return nil, err
	}
	defer func() { _ = release() }()

	requestID := "sell:" + clientID
	if existing, found, err := s.pg.GetTradeRequest(ctx, tokenID, userID, requestID); err != nil {
		return nil, err
	} else if found {
		return existing, nil
	}
	holder, err := s.pg.GetHolder(ctx, tokenID, userID)
	if err != nil {
		return nil, err
	}
	if holder == nil || holder.BalanceMinor < tokensInMinor {
		return nil, errors.New("INSUFFICIENT_TOKEN_BALANCE")
	}

	tradeID := uuid.New()
	settlementKey := settlementKey("sell", tokenID, userID, clientID)
	settlementRef := "launchpad-sell:" + tradeID.String()
	settlementMeta := map[string]any{
		"token_id": tokenID.String(), "trade_id": tradeID.String(),
		"token_in_minor": tokensInMinor, "fee_minor": fee,
	}
	// Remove the gross curve area from reserve before paying the seller. Net
	// proceeds are credited to the seller; the retained fee is credited to treasury.
	grossReserveDebit := out + fee
	reserveDebited, treasuryCredited := false, false
	if _, err := s.wallet.DebitReserve(ctx, grossReserveDebit, settlementRef, "reserve-"+settlementKey, settlementMeta); err != nil {
		return nil, fmt.Errorf("RESERVE_DEBIT_FAILED: %w", err)
	}
	reserveDebited = true
	if fee > 0 {
		if _, err := s.wallet.CreditTreasury(ctx, fee, settlementRef, "treasury-"+settlementKey, settlementMeta); err != nil {
			_, reserveErr := s.wallet.CreditReserve(ctx, grossReserveDebit, settlementRef, "reserve-reversal-"+settlementKey, settlementMeta)
			if reserveErr != nil {
				return nil, fmt.Errorf("%w; reserve restoration failed: %v", err, reserveErr)
			}
			return nil, fmt.Errorf("TREASURY_CREDIT_FAILED: %w", err)
		}
		treasuryCredited = true
	}
	walletTxID, err := s.wallet.CreditTrade(ctx, userID.String(), out, settlementRef, settlementKey, settlementMeta)
	if err != nil {
		var rollbackErrs []error
		if treasuryCredited {
			if _, e := s.wallet.DebitTreasury(ctx, fee, settlementRef, "treasury-reversal-"+settlementKey, settlementMeta); e != nil {
				rollbackErrs = append(rollbackErrs, e)
			}
		}
		if reserveDebited {
			if _, e := s.wallet.CreditReserve(ctx, grossReserveDebit, settlementRef, "reserve-reversal-"+settlementKey, settlementMeta); e != nil {
				rollbackErrs = append(rollbackErrs, e)
			}
		}
		if len(rollbackErrs) > 0 {
			return nil, fmt.Errorf("SETTLEMENT_CREDIT_FAILED: %w; compensation failed: %v", err, rollbackErrs)
		}
		return nil, fmt.Errorf("SETTLEMENT_CREDIT_FAILED: %w", err)
	}
	reversePayout := func(cause error) error {
		var rollbackErrs []error
		if _, err := s.wallet.Debit(ctx, userID.String(), out, settlementRef, "reversal-"+settlementKey, settlementMeta); err != nil {
			rollbackErrs = append(rollbackErrs, err)
		}
		if treasuryCredited {
			if _, err := s.wallet.DebitTreasury(ctx, fee, settlementRef, "treasury-reversal-"+settlementKey, settlementMeta); err != nil {
				rollbackErrs = append(rollbackErrs, err)
			}
		}
		if reserveDebited {
			if _, err := s.wallet.CreditReserve(ctx, grossReserveDebit, settlementRef, "reserve-reversal-"+settlementKey, settlementMeta); err != nil {
				rollbackErrs = append(rollbackErrs, err)
			}
		}
		if len(rollbackErrs) > 0 {
			s.log.Error("wallet compensation after failed sell state update", zap.Errors("rollback_errors", rollbackErrs), zap.Error(cause), zap.String("trade_id", tradeID.String()))
			return fmt.Errorf("%w; settlement reversal failed: %v", cause, rollbackErrs)
		}
		return cause
	}
	newState := *st
	newState.SupplyCirculatingMinor = newSup
	newState.ReserveRialMinor = newRes
	res := &domain.BuyResult{
		Quote: domain.BuyQuote{
			Token: *tk, AmountInMinor: tokensInMinor, AmountOutMinor: out, FeeMinor: fee,
			NewReserveMinor: newRes, NewSupplyMinor: newSup, WillGraduate: false,
		},
		TradeID: tradeID, TxHash: walletTxID, NewBonding: newState, ExecutedAt: time.Now(),
	}
	if err := s.pg.ApplyTradeState(ctx, tokenID, userID, -tokensInMinor, &newState, requestID, res); err != nil {
		if errors.Is(err, store.ErrTradeRequestExists) {
			if existing, found, getErr := s.pg.GetTradeRequest(ctx, tokenID, userID, requestID); getErr == nil && found {
				return existing, nil
			}
		}
		return nil, reversePayout(err)
	}
	s.nc.Publish(ctx, "launchpad.sell", res)
	s.kc.Audit(ctx, tokenID.String(), res)
	return res, nil
}

// ---- helpers ----

func (s *Service) tokenAndState(ctx context.Context, id uuid.UUID) (*domain.Token, *domain.BondingState, error) {
	t, err := s.pg.GetToken(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	bs, err := s.pg.GetBonding(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	return t, bs, nil
}

func (s *Service) isPlatformPaused(ctx context.Context) bool {
	var paused bool
	if err := s.pg.Pool.QueryRow(ctx, `SELECT COALESCE((value = 'true'::jsonb), false) FROM operations.platform_settings WHERE key = 'launchpad_paused'`).Scan(&paused); err != nil {
		s.log.Warn("platform pause lookup failed", zap.Error(err))
		return strings.EqualFold(s.cfg.Env, "production")
	}
	return paused
}

func (s *Service) validateCreateInput(in CreateTokenInput) error {
	if strings.TrimSpace(in.Name) == "" {
		return errors.New("NAME_REQUIRED")
	}
	if !validSymbol(in.Symbol) {
		return errors.New("INVALID_SYMBOL")
	}
	if in.Decimals < 0 || in.Decimals > 18 {
		return errors.New("DECIMALS_OUT_OF_RANGE")
	}
	if in.TotalSupply == "" || in.TotalSupply == "0" {
		return errors.New("TOTAL_SUPPLY_REQUIRED")
	}
	if in.Chain == "" {
		in.Chain = "solana"
	}
	if in.ContractAddress == "" {
		return errors.New("CONTRACT_ADDRESS_REQUIRED")
	}
	if in.GraduationRialMinor <= 0 {
		in.GraduationRialMinor = s.cfg.Launchpad.GraduationMinor
	}
	if in.LogoURL != "" {
		if _, err := url.Parse(in.LogoURL); err != nil {
			return errors.New("INVALID_LOGO_URL")
		}
	}
	return nil
}

func validSymbol(s string) bool {
	if len(s) < 2 || len(s) > 12 {
		return false
	}
	for _, c := range s {
		if !((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
			return false
		}
	}
	return true
}

func settlementKey(side string, tokenID, userID uuid.UUID, clientID string) string {
	input := side + "|" + tokenID.String() + "|" + userID.String() + "|" + clientID
	digest := sha256.Sum256([]byte(input))
	return "lp-" + hex.EncodeToString(digest[:])
}

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func priceImpactBps(s *curve.State, m curve.Model, rialInMinor int64) int {
	if rialInMinor <= 0 {
		return 0
	}
	before, _ := s.SpotPriceFor(m, s.SupplyMinor)
	out, _, _, _, _ := (&curve.Engine{}).QuoteBuy(s, m, rialInMinor)
	if out == 0 {
		return 0
	}
	after, _ := s.SpotPriceFor(m, s.SupplyMinor+out)
	if before <= 0 {
		return 0
	}
	return int((after - before) / before * 10_000)
}
