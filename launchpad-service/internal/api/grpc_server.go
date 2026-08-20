package api

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/rial/launchpad-service/internal/domain"
	"github.com/rial/launchpad-service/internal/launch"
)

func (s *Server) Healthz(context.Context, *Empty) (*HealthResponse, error) {
	return &HealthResponse{Status: "ok", Version: "launchpad-service"}, nil
}

func (s *Server) GetToken(ctx context.Context, req *GetTokenRequest) (*TokenResponse, error) {
	id, err := uuid.Parse(req.GetId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid token id")
	}
	t, err := s.launch.Get(ctx, id)
	if err != nil {
		return nil, mapGRPCError(err)
	}
	return &TokenResponse{Token: tokenProto(t)}, nil
}

func (s *Server) ListTokens(ctx context.Context, req *ListTokensRequest) (*ListTokensResponse, error) {
	limit, offset := int(req.GetLimit()), int(req.GetOffset())
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	if offset < 0 {
		offset = 0
	}
	tokens, err := s.launch.List(ctx, req.GetStatus(), limit, offset)
	if err != nil {
		return nil, mapGRPCError(err)
	}
	out := make([]*Token, 0, len(tokens))
	for _, t := range tokens {
		out = append(out, tokenProto(t))
	}
	return &ListTokensResponse{Tokens: out}, nil
}

func (s *Server) CreateToken(ctx context.Context, req *CreateTokenRequest) (*TokenResponse, error) {
	creator, err := uuid.Parse(req.GetCreatorId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid creator id")
	}
	vesting := make([]launch.VestingInput, 0, len(req.GetVesting()))
	for _, v := range req.GetVesting() {
		if v.GetStartAt() == nil || !v.GetStartAt().IsValid() {
			return nil, status.Error(codes.InvalidArgument, "vesting.start_at is required")
		}
		start := v.GetStartAt().AsTime()
		totalMinor, err := parseInt64(v.GetTotalMinor())
		if err != nil {
			return nil, status.Error(codes.InvalidArgument, "vesting.total_minor must be a valid int64")
		}
		vesting = append(vesting, launch.VestingInput{Beneficiary: v.GetBeneficiary(), TotalMinor: totalMinor, CliffSeconds: int(v.GetCliffSeconds()), DurationSeconds: int(v.GetDurationSeconds()), StartAt: start})
	}
	graduationRialMinor, err := parseInt64(req.GetGraduationRialMinor())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "graduation_rial_minor must be a valid int64")
	}
	t, err := s.launch.Create(ctx, creator, launch.CreateTokenInput{
		Name: req.GetName(), Symbol: req.GetSymbol(), Decimals: int(req.GetDecimals()), TotalSupply: req.GetTotalSupply(), Chain: req.GetChain(), ContractAddress: req.GetContractAddress(),
		LogoURL: req.GetLogoUrl(), BannerURL: req.GetBannerUrl(), Description: req.GetDescription(), Website: req.GetWebsite(), Telegram: req.GetTelegram(), Twitter: req.GetTwitter(), Discord: req.GetDiscord(), GitHub: req.GetGithub(),
		MintAuthority: req.GetMintAuthority(), FreezeAuthority: req.GetFreezeAuthority(), CurveModel: req.GetCurveModel(), CurveParams: []byte(req.GetCurveParamsJson()), GraduationRialMinor: graduationRialMinor, Vesting: vesting,
	})
	if err != nil {
		return nil, mapGRPCError(err)
	}
	return &TokenResponse{Token: tokenProto(t)}, nil
}

func (s *Server) ApproveToken(ctx context.Context, req *TokenActionRequest) (*Empty, error) {
	actor, token, err := parseActionIDs(req.GetActorId(), req.GetTokenId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	return &Empty{}, s.launch.Approve(ctx, actor, token)
}
func (s *Server) RejectToken(ctx context.Context, req *RejectTokenRequest) (*Empty, error) {
	actor, token, err := parseActionIDs(req.GetActorId(), req.GetTokenId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	return &Empty{}, s.launch.Reject(ctx, actor, token, req.GetReason())
}
func (s *Server) PauseToken(ctx context.Context, req *PauseTokenRequest) (*Empty, error) {
	actor, token, err := parseActionIDs(req.GetActorId(), req.GetTokenId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	return &Empty{}, s.launch.Pause(ctx, actor, token, req.GetReason())
}

func (s *Server) QuoteBuy(ctx context.Context, req *QuoteBuyRequest) (*BuyQuoteResponse, error) {
	tokenID, err := parseUUID(req.GetTokenId())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	amount, err := parseInt64(req.GetAmountInMinor())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "amount_in_minor must be a valid int64")
	}
	q, err := s.launch.QuoteBuy(ctx, tokenID, amount)
	if err != nil {
		return nil, mapGRPCError(err)
	}
	return &BuyQuoteResponse{Quote: quoteProto(q)}, nil
}
func (s *Server) Buy(ctx context.Context, req *BuyRequest) (*BuyResultResponse, error) {
	userID, tokenID, amount, err := parseTradeIDsAndAmount(req.GetUserId(), req.GetTokenId(), req.GetAmountInMinor())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	r, err := s.launch.Buy(ctx, userID, tokenID, amount, req.GetClientId())
	if err != nil {
		return nil, mapGRPCError(err)
	}
	return resultProto(r)
}
func (s *Server) Sell(ctx context.Context, req *SellRequest) (*BuyResultResponse, error) {
	userID, tokenID, amount, err := parseTradeIDsAndAmount(req.GetUserId(), req.GetTokenId(), req.GetAmountInMinor())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, err.Error())
	}
	r, err := s.launch.Sell(ctx, userID, tokenID, amount, req.GetClientId())
	if err != nil {
		return nil, mapGRPCError(err)
	}
	return resultProto(r)
}

func tokenProto(t *domain.Token) *Token {
	if t == nil {
		return nil
	}
	return &Token{Id: t.ID.String(), CreatorId: t.CreatorID.String(), Chain: t.Chain, ContractAddress: t.ContractAddress, Name: t.Name, Symbol: t.Symbol, Decimals: int32(t.Decimals), TotalSupply: t.TotalSupply, LogoUrl: stringPtr(t.LogoURL), BannerUrl: stringPtr(t.BannerURL), Description: stringPtr(t.Description), Website: stringPtr(t.Website), Telegram: stringPtr(t.Telegram), Twitter: stringPtr(t.Twitter), Discord: stringPtr(t.Discord), Github: stringPtr(t.GitHub), MintAuthority: stringPtr(t.MintAuthority), FreezeAuthority: stringPtr(t.FreezeAuthority), CurveModel: t.CurveModel, GraduationRialMinor: strconv.FormatInt(t.GraduationRialMinor, 10), Graduated: t.Graduated, Status: string(t.Status), CreatedAt: timestamppb.New(t.CreatedAt), UpdatedAt: timestamppb.New(t.UpdatedAt)}
}
func quoteProto(q *domain.BuyQuote) *BuyQuote {
	return &BuyQuote{Token: tokenProto(&q.Token), AmountInMinor: strconv.FormatInt(q.AmountInMinor, 10), AmountOutMinor: strconv.FormatInt(q.AmountOutMinor, 10), FeeMinor: strconv.FormatInt(q.FeeMinor, 10), PriceImpactBps: int32(q.PriceImpactBps), NewReserveMinor: strconv.FormatInt(q.NewReserveMinor, 10), NewSupplyMinor: strconv.FormatInt(q.NewSupplyMinor, 10), WillGraduate: q.WillGraduate}
}
func resultProto(r *domain.BuyResult) (*BuyResultResponse, error) {
	return &BuyResultResponse{Quote: quoteProto(&r.Quote), TradeId: r.TradeID.String(), TxHash: r.TxHash, ExecutedAt: timestamppb.New(r.ExecutedAt)}, nil
}
func stringPtr(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
func parseInt64(v string) (int64, error) {
	value := strings.TrimSpace(v)
	if value == "" {
		return 0, fmt.Errorf("value must not be empty")
	}
	n, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("value must be a valid int64")
	}
	return n, nil
}

func parseUUID(v string) (uuid.UUID, error) {
	id, err := uuid.Parse(strings.TrimSpace(v))
	if err != nil {
		return uuid.Nil, fmt.Errorf("value must be a valid UUID")
	}
	return id, nil
}

func parseActionIDs(actorValue, tokenValue string) (uuid.UUID, uuid.UUID, error) {
	actor, err := parseUUID(actorValue)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("actor_id must be a valid UUID")
	}
	token, err := parseUUID(tokenValue)
	if err != nil {
		return uuid.Nil, uuid.Nil, fmt.Errorf("token_id must be a valid UUID")
	}
	return actor, token, nil
}

func parseTradeIDsAndAmount(userValue, tokenValue, amountValue string) (uuid.UUID, uuid.UUID, int64, error) {
	userID, err := parseUUID(userValue)
	if err != nil {
		return uuid.Nil, uuid.Nil, 0, fmt.Errorf("user_id must be a valid UUID")
	}
	tokenID, err := parseUUID(tokenValue)
	if err != nil {
		return uuid.Nil, uuid.Nil, 0, fmt.Errorf("token_id must be a valid UUID")
	}
	amount, err := parseInt64(amountValue)
	if err != nil {
		return uuid.Nil, uuid.Nil, 0, fmt.Errorf("amount_in_minor must be a valid int64")
	}
	return userID, tokenID, amount, nil
}
func mapGRPCError(err error) error {
	if err == nil {
		return nil
	}
	return status.Error(codes.InvalidArgument, err.Error())
}
