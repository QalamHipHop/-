package api

import (
	"context"
	"strconv"

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
		vesting = append(vesting, launch.VestingInput{Beneficiary: v.GetBeneficiary(), TotalMinor: parseInt64(v.GetTotalMinor()), CliffSeconds: int(v.GetCliffSeconds()), DurationSeconds: int(v.GetDurationSeconds()), StartAt: start})
	}
	t, err := s.launch.Create(ctx, creator, launch.CreateTokenInput{
		Name: req.GetName(), Symbol: req.GetSymbol(), Decimals: int(req.GetDecimals()), TotalSupply: req.GetTotalSupply(), Chain: req.GetChain(), ContractAddress: req.GetContractAddress(),
		LogoURL: req.GetLogoUrl(), BannerURL: req.GetBannerUrl(), Description: req.GetDescription(), Website: req.GetWebsite(), Telegram: req.GetTelegram(), Twitter: req.GetTwitter(), Discord: req.GetDiscord(), GitHub: req.GetGithub(),
		MintAuthority: req.GetMintAuthority(), FreezeAuthority: req.GetFreezeAuthority(), CurveModel: req.GetCurveModel(), CurveParams: []byte(req.GetCurveParamsJson()), GraduationRialMinor: parseInt64(req.GetGraduationRialMinor()), Vesting: vesting,
	})
	if err != nil {
		return nil, mapGRPCError(err)
	}
	return &TokenResponse{Token: tokenProto(t)}, nil
}

func (s *Server) ApproveToken(ctx context.Context, req *TokenActionRequest) (*Empty, error) {
	return &Empty{}, s.launch.Approve(ctx, mustUUID(req.GetActorId()), mustUUID(req.GetTokenId()))
}
func (s *Server) RejectToken(ctx context.Context, req *RejectTokenRequest) (*Empty, error) {
	return &Empty{}, s.launch.Reject(ctx, mustUUID(req.GetActorId()), mustUUID(req.GetTokenId()), req.GetReason())
}
func (s *Server) PauseToken(ctx context.Context, req *PauseTokenRequest) (*Empty, error) {
	return &Empty{}, s.launch.Pause(ctx, mustUUID(req.GetActorId()), mustUUID(req.GetTokenId()), req.GetReason())
}

func (s *Server) QuoteBuy(ctx context.Context, req *QuoteBuyRequest) (*BuyQuoteResponse, error) {
	q, err := s.launch.QuoteBuy(ctx, mustUUID(req.GetTokenId()), parseInt64(req.GetAmountInMinor()))
	if err != nil {
		return nil, mapGRPCError(err)
	}
	return &BuyQuoteResponse{Quote: quoteProto(q)}, nil
}
func (s *Server) Buy(ctx context.Context, req *BuyRequest) (*BuyResultResponse, error) {
	r, err := s.launch.Buy(ctx, mustUUID(req.GetUserId()), mustUUID(req.GetTokenId()), parseInt64(req.GetAmountInMinor()), req.GetClientId())
	if err != nil {
		return nil, mapGRPCError(err)
	}
	return resultProto(r)
}
func (s *Server) Sell(ctx context.Context, req *SellRequest) (*BuyResultResponse, error) {
	r, err := s.launch.Sell(ctx, mustUUID(req.GetUserId()), mustUUID(req.GetTokenId()), parseInt64(req.GetAmountInMinor()), req.GetClientId())
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
func parseInt64(v string) int64   { n, _ := strconv.ParseInt(v, 10, 64); return n }
func mustUUID(v string) uuid.UUID { id, _ := uuid.Parse(v); return id }
func mapGRPCError(err error) error {
	if err == nil {
		return nil
	}
	return status.Error(codes.InvalidArgument, err.Error())
}
