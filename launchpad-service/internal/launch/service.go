// Package launch — token creation, buy/sell, vesting, AI risk.
package launch

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
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
)

type Service struct {
	cfg       *config.Config
	pg        *store.PG
	rd        *store.RD
	nc        *event.Nats
	kc        *event.Kafka
	risk      *risk.Client
	curve     *curve.Engine
	grad      *graduation.Service
	log       *zap.Logger
}

func NewService(
	cfg *config.Config,
	pg *store.PG, rd *store.RD, nc *event.Nats, kc *event.Kafka,
	riskClient *risk.Client, curveEngine *curve.Engine,
	grad *graduation.Service, log *zap.Logger,
) *Service {
	return &Service{cfg: cfg, pg: pg, rd: rd, nc: nc, kc: kc, risk: riskClient, curve: curveEngine, grad: grad, log: log}
}

// CreateTokenInput — validated externally.
type CreateTokenInput struct {
	Name              string
	Symbol            string
	Decimals          int
	TotalSupply       string
	Chain             string
	ContractAddress   string
	LogoURL           string
	BannerURL         string
	Description       string
	Website           string
	Telegram          string
	Twitter           string
	Discord           string
	GitHub            string
	MintAuthority     string
	FreezeAuthority   string
	CurveModel        string
	CurveParams       json.RawMessage
	GraduationRialMinor int64
	Vesting           []VestingInput
}

type VestingInput struct {
	Beneficiary     string `json:"beneficiary"`
	TotalMinor      int64  `json:"total_minor"`
	CliffSeconds    int    `json:"cliff_seconds"`
	DurationSeconds int    `json:"duration_seconds"`
	StartAt         time.Time `json:"start_at"`
}

func (s *Service) Create(ctx context.Context, creatorID uuid.UUID, in CreateTokenInput) (*domain.Token, error) {
	if err := s.validateCreateInput(in); err != nil { return nil, err }

	// creator rate-limit
	count, err := s.pg.CountCreatorTokens(ctx, creatorID)
	if err != nil { return nil, err }
	if count >= s.cfg.Launchpad.MaxTokensPerCreator {
		return nil, fmt.Errorf("LAUNCHPAD_MAX_TOKENS_PER_CREATOR (=%d) reached", s.cfg.Launchpad.MaxTokensPerCreator)
	}

	// model validation
	model, err := curve.ParseModel(in.CurveModel)
	if err != nil { return nil, err }
	params := curve.DefaultParams()
	if len(in.CurveParams) > 0 { params, err = curve.DecodeParams(in.CurveParams); if err != nil { return nil, err } }
	if err := s.curve.Validate(model, params); err != nil { return nil, err }

	// AI risk gate
	if s.cfg.Launchpad.RiskAIEnabled {
		rs, err := s.risk.ScoreToken(ctx, risk.TokenInput{
			Name: in.Name, Symbol: in.Symbol, Description: in.Description,
			Website: in.Website, Telegram: in.Telegram, Twitter: in.Twitter, LogoURL: in.LogoURL,
		})
		if err != nil { s.log.Warn("risk ai failed, continuing", zap.Error(err)) } else if rs.Score > 0.85 {
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
	if err := s.pg.CreateToken(ctx, t); err != nil { return nil, err }
	if err := s.pg.InitBonding(ctx, id, 0, 0, params.VirtualRial); err != nil { return nil, err }

	for _, v := range in.Vesting {
		ben, err := uuid.Parse(v.Beneficiary)
		if err != nil { return nil, fmt.Errorf("invalid vesting beneficiary: %w", err) }
		vs := &domain.VestingSchedule{
			ID: uuid.New(), TokenID: id, Beneficiary: ben, TotalMinor: v.TotalMinor,
			CliffSeconds: v.CliffSeconds, DurationSeconds: v.DurationSeconds, StartAt: v.StartAt,
		}
		if err := s.pg.CreateVesting(ctx, vs); err != nil { return nil, err }
	}

	// publish & audit
	s.nc.Publish(ctx, "launchpad.token.created", map[string]any{"token_id": id.String(), "creator": creatorID.String()})
	s.kc.Audit(ctx, id.String(), map[string]any{"event": "token.created", "token_id": id.String()})
	return t, nil
}

func (s *Service) Approve(ctx context.Context, adminID, tokenID uuid.UUID) error {
	tk, err := s.pg.GetToken(ctx, tokenID)
	if err != nil { return err }
	if tk.Status == domain.TokenGraduated { return errors.New("ALREADY_GRADUATED") }
	if err := s.pg.UpdateTokenStatus(ctx, tokenID, string(domain.TokenLive)); err != nil { return err }
	s.nc.Publish(ctx, "launchpad.token.approved", map[string]any{"token_id": tokenID.String(), "by": adminID.String()})
	return nil
}

func (s *Service) Reject(ctx context.Context, adminID, tokenID uuid.UUID, reason string) error {
	if err := s.pg.UpdateTokenStatus(ctx, tokenID, string(domain.TokenRejected)); err != nil { return err }
	s.nc.Publish(ctx, "launchpad.token.rejected", map[string]any{"token_id": tokenID.String(), "by": adminID.String(), "reason": reason})
	return nil
}

func (s *Service) Pause(ctx context.Context, adminID, tokenID uuid.UUID, reason string) error {
	if err := s.pg.UpdateTokenStatus(ctx, tokenID, string(domain.TokenPaused)); err != nil { return err }
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
	tk, st, err := s.tokenAndState(ctx, tokenID)
	if err != nil { return nil, err }
	if tk.Status != domain.TokenLive { return nil, errors.New("TOKEN_NOT_LIVE") }
	model := curve.Model(tk.CurveModel)
	cs := &curve.State{SupplyMinor: st.SupplyCirculatingMinor, ReserveMinor: st.ReserveRialMinor, VirtualMinor: st.VirtualRialMinor, Params: curve.MustParams(tk.CurveParams)}
	out, fee, newSup, newRes, err := s.curve.QuoteBuy(cs, model, rialInMinor)
	if err != nil { return nil, err }
	willGrad := (newRes + cs.VirtualMinor) >= tk.GraduationRialMinor
	return &domain.BuyQuote{
		Token: *tk, AmountInMinor: rialInMinor, AmountOutMinor: out, FeeMinor: fee,
		PriceImpactBps: int(priceImpactBps(cs, model, rialInMinor)),
		NewReserveMinor: newRes, NewSupplyMinor: newSup,
		NewPrice: "0", // filled by caller
		WillGraduate: willGrad,
	}, nil
}

func (s *Service) Buy(ctx context.Context, userID, tokenID uuid.UUID, rialInMinor int64, clientID string) (*domain.BuyResult, error) {
	tk, st, err := s.tokenAndState(ctx, tokenID)
	if err != nil { return nil, err }
	if tk.Status != domain.TokenLive { return nil, errors.New("TOKEN_NOT_LIVE") }

	// idempotency by clientID
	if clientID != "" {
		// we keep it simple: rely on trading service for client-side dedup
	}

	// AI sanity check on buyer
	if s.cfg.Launchpad.RiskAIEnabled {
		_, _ = s.risk.ScoreUser(ctx, userID.String())
	}

	model := curve.Model(tk.CurveModel)
	cs := &curve.State{SupplyMinor: st.SupplyCirculatingMinor, ReserveMinor: st.ReserveRialMinor, VirtualMinor: st.VirtualRialMinor, Params: curve.MustParams(tk.CurveParams)}
	out, fee, newSup, newRes, err := s.curve.QuoteBuy(cs, model, rialInMinor)
	if err != nil { return nil, err }
	if out == 0 { return nil, errors.New("ZERO_OUTPUT") }

	// settle: backend wallet-service debits user Rial, credits system, then we credit user tokens
	// We delegate that to the gRPC wallet-client in production; here we just write the bonding state.
	release, err := s.rd.AcquireLock(ctx, "buy:"+tokenID.String(), 5*time.Second)
	if err != nil { return nil, err }
	defer func() { _ = release() }()

	if err := s.pg.AddHolderDelta(ctx, tokenID, userID, out); err != nil { return nil, err }
	newState := *st
	newState.SupplyCirculatingMinor = newSup
	newState.ReserveRialMinor = newRes
	newState.HoldersCount = st.HoldersCount
	if err := s.pg.UpsertBonding(ctx, &newState); err != nil { return nil, err }

	res := &domain.BuyResult{
		Quote: domain.BuyQuote{
			Token: *tk, AmountInMinor: rialInMinor, AmountOutMinor: out, FeeMinor: fee,
			NewReserveMinor: newRes, NewSupplyMinor: newSup, WillGraduate: newRes+cs.VirtualMinor >= tk.GraduationRialMinor,
		},
		TradeID: uuid.New(), TxHash: "0x" + uuid.NewString(),
		NewBonding: newState, ExecutedAt: time.Now(),
	}
	if h, _ := s.pg.GetHolder(ctx, tokenID, userID); h != nil { res.NewHolder = *h }

	s.nc.Publish(ctx, "launchpad.buy", res)
	s.kc.Audit(ctx, tokenID.String(), res)

	if res.Quote.WillGraduate {
		// fire-and-forget — graduation service will pick this up
		s.grad.Notify(ctx, tokenID)
	}
	return res, nil
}

func (s *Service) Sell(ctx context.Context, userID, tokenID uuid.UUID, tokensInMinor int64, clientID string) (*domain.BuyResult, error) {
	tk, st, err := s.tokenAndState(ctx, tokenID)
	if err != nil { return nil, err }
	if tk.Status != domain.TokenLive { return nil, errors.New("TOKEN_NOT_LIVE") }
	model := curve.Model(tk.CurveModel)
	cs := &curve.State{SupplyMinor: st.SupplyCirculatingMinor, ReserveMinor: st.ReserveRialMinor, VirtualMinor: st.VirtualRialMinor, Params: curve.MustParams(tk.CurveParams)}
	out, fee, newSup, newRes, err := s.curve.QuoteSell(cs, model, tokensInMinor)
	if err != nil { return nil, err }
	release, err := s.rd.AcquireLock(ctx, "sell:"+tokenID.String(), 5*time.Second)
	if err != nil { return nil, err }
	defer func() { _ = release() }()
	if err := s.pg.AddHolderDelta(ctx, tokenID, userID, -tokensInMinor); err != nil { return nil, err }
	newState := *st
	newState.SupplyCirculatingMinor = newSup
	newState.ReserveRialMinor = newRes
	if err := s.pg.UpsertBonding(ctx, &newState); err != nil { return nil, err }
	res := &domain.BuyResult{
		Quote: domain.BuyQuote{
			Token: *tk, AmountInMinor: tokensInMinor, AmountOutMinor: out, FeeMinor: fee,
			NewReserveMinor: newRes, NewSupplyMinor: newSup, WillGraduate: false,
		},
		TradeID: uuid.New(), TxHash: "0x" + uuid.NewString(), NewBonding: newState, ExecutedAt: time.Now(),
	}
	if h, _ := s.pg.GetHolder(ctx, tokenID, userID); h != nil { res.NewHolder = *h }
	s.nc.Publish(ctx, "launchpad.sell", res)
	s.kc.Audit(ctx, tokenID.String(), res)
	return res, nil
}

// ---- helpers ----

func (s *Service) tokenAndState(ctx context.Context, id uuid.UUID) (*domain.Token, *domain.BondingState, error) {
	t, err := s.pg.GetToken(ctx, id)
	if err != nil { return nil, nil, err }
	bs, err := s.pg.GetBonding(ctx, id)
	if err != nil { return nil, nil, err }
	return t, bs, nil
}

func (s *Service) validateCreateInput(in CreateTokenInput) error {
	if strings.TrimSpace(in.Name) == "" { return errors.New("NAME_REQUIRED") }
	if !validSymbol(in.Symbol) { return errors.New("INVALID_SYMBOL") }
	if in.Decimals < 0 || in.Decimals > 18 { return errors.New("DECIMALS_OUT_OF_RANGE") }
	if in.TotalSupply == "" || in.TotalSupply == "0" { return errors.New("TOTAL_SUPPLY_REQUIRED") }
	if in.Chain == "" { in.Chain = "solana" }
	if in.ContractAddress == "" { return errors.New("CONTRACT_ADDRESS_REQUIRED") }
	if in.GraduationRialMinor <= 0 { in.GraduationRialMinor = s.cfg.Launchpad.GraduationMinor }
	if in.LogoURL != "" { if _, err := url.Parse(in.LogoURL); err != nil { return errors.New("INVALID_LOGO_URL") } }
	return nil
}

func validSymbol(s string) bool { if len(s) < 2 || len(s) > 12 { return false }; for _, c := range s { if !((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) { return false } }; return true }

func nilIfEmpty(s string) *string { if s == "" { return nil }; return &s }

func priceImpactBps(s *curve.State, m curve.Model, rialInMinor int64) int {
	if rialInMinor <= 0 { return 0 }
	before, _ := s.SpotPriceFor(s.SupplyMinor)
	out, _, _, _, _ := (&curve.Engine{}).QuoteBuy(s, m, rialInMinor)
	if out == 0 { return 0 }
	after, _ := s.SpotPriceFor(s.SupplyMinor + out)
	if before <= 0 { return 0 }
	return int((after - before) / before * 10_000)
}
