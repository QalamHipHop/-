package api

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/rial/wallet-service/internal/config"
	"github.com/rial/wallet-service/internal/domain"
	"github.com/rial/wallet-service/internal/ledger"
)

type settleDepositReq struct {
	UserID         string         `json:"user_id" binding:"required,uuid"`
	Amount         string         `json:"amount" binding:"required"`
	Reference      string         `json:"reference"`
	IdempotencyKey string         `json:"idempotency_key" binding:"required,min=8,max=128"`
	Metadata       map[string]any `json:"metadata"`
}

type tradeSettlementReq struct {
	BuyerID        string         `json:"buyer_id" binding:"required,uuid"`
	SellerID       string         `json:"seller_id" binding:"required,uuid"`
	Notional       string         `json:"notional" binding:"required"`
	BuyerFee       string         `json:"buyer_fee" binding:"required"`
	SellerFee      string         `json:"seller_fee" binding:"required"`
	Reference      string         `json:"reference" binding:"required"`
	IdempotencyKey string         `json:"idempotency_key" binding:"required,min=8,max=128"`
	Metadata       map[string]any `json:"metadata"`
}

type creditReq struct {
	UserID         string         `json:"user_id" binding:"required,uuid"`
	Amount         string         `json:"amount" binding:"required"`
	Type           string         `json:"type" binding:"required"`
	Reference      string         `json:"reference"`
	IdempotencyKey string         `json:"idempotency_key" binding:"required,min=8,max=128"`
	Metadata       map[string]any `json:"metadata"`
}

type debitReq struct {
	UserID         string         `json:"user_id" binding:"required,uuid"`
	Amount         string         `json:"amount" binding:"required"`
	Type           string         `json:"type" binding:"required"`
	Reference      string         `json:"reference"`
	IdempotencyKey string         `json:"idempotency_key" binding:"required,min=8,max=128"`
	Metadata       map[string]any `json:"metadata"`
}

type escrowReq struct {
	UserID         string         `json:"user_id" binding:"required,uuid"`
	Amount         string         `json:"amount" binding:"required"`
	Reference      string         `json:"reference" binding:"required"`
	IdempotencyKey string         `json:"idempotency_key" binding:"required,min=8,max=128"`
	Metadata       map[string]any `json:"metadata"`
}

type internalLedgerReq struct {
	Amount         string         `json:"amount" binding:"required"`
	Type           string         `json:"type" binding:"required,oneof=trade fee refund"`
	Reference      string         `json:"reference"`
	IdempotencyKey string         `json:"idempotency_key" binding:"required,min=8,max=128"`
	Metadata       map[string]any `json:"metadata"`
}

type transferReq struct {
	FromUserID     string         `json:"from_user_id" binding:"required,uuid"`
	ToUserID       string         `json:"to_user_id" binding:"required,uuid"`
	Amount         string         `json:"amount" binding:"required"`
	Reference      string         `json:"reference"`
	Actor          string         `json:"actor" binding:"required"`
	IdempotencyKey string         `json:"idempotency_key" binding:"required,min=8,max=128"`
	Metadata       map[string]any `json:"metadata"`
}

type withdrawalDestinationReq struct {
	UserID      string `json:"user_id" binding:"required,uuid"`
	Chain       string `json:"chain" binding:"required,oneof=evm solana btc iban"`
	Destination string `json:"destination" binding:"required"`
	Label       string `json:"label"`
}

type confirmWithdrawalDestinationReq struct {
	UserID string `json:"user_id" binding:"required,uuid"`
	Token  string `json:"token" binding:"required,min=32,max=128"`
}

type withdrawReq struct {
	UserID         string `json:"user_id" binding:"required,uuid"`
	Amount         string `json:"amount" binding:"required"`
	Chain          string `json:"chain" binding:"required,oneof=evm solana btc iban"`
	Destination    string `json:"destination" binding:"required"`
	IdempotencyKey string `json:"idempotency_key" binding:"required,min=8,max=128"`
}

func RegisterRoutes(r *gin.Engine, svc *ledger.Service, cfg *config.Config) {
	h := &handler{svc: svc, cfg: cfg}

	// Wallet data and every balance mutation are internal-only. The public
	// gateway must authenticate an end user before it calls this service.
	v1 := r.Group("/v1")
	v1.Use(internalAuth(cfg.InternalToken))
	{
		v1.GET("/accounts/:user_id", h.getAccount)
		v1.POST("/credit", h.credit)
		v1.POST("/settle-deposit", h.settleDeposit)
		v1.POST("/settle-trade", h.settleTrade)
		v1.POST("/debit", h.debit)
		v1.POST("/accounts/:user_id/reserve", h.reserve)
		v1.POST("/accounts/:user_id/release", h.release)
		v1.POST("/transfer", h.transfer)
		v1.POST("/internal/:kind/credit", h.creditInternal)
		v1.POST("/internal/:kind/debit", h.debitInternal)
		v1.GET("/accounts/:user_id/withdrawal-destinations", h.listWithdrawalDestinations)
		v1.POST("/withdrawal-destinations", h.createWithdrawalDestination)
		v1.POST("/withdrawal-destinations/:id/confirm", h.confirmWithdrawalDestination)
		v1.DELETE("/withdrawal-destinations/:id", h.revokeWithdrawalDestination)
		v1.POST("/withdraw", h.withdraw)
		v1.POST("/withdraw/:id/sign", h.signWithdrawal)
		v1.POST("/withdraw/:id/cancel", h.cancelWithdrawal)
		v1.GET("/accounts/:user_id/transactions", h.listTransactions)
	}
}

func internalAuth(expected string) gin.HandlerFunc {
	return func(c *gin.Context) {
		provided := c.GetHeader("X-Rial-Internal-Token")
		if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "internal_auth_required"})
			return
		}
		c.Next()
	}
}

type handler struct {
	svc *ledger.Service
	cfg *config.Config
}

func (h *handler) getAccount(c *gin.Context) {
	uid, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_user_id"})
		return
	}
	acc, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, acc)
}

func (h *handler) settleTrade(c *gin.Context) {
	var req tradeSettlementReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	buyerID, err := uuid.Parse(req.BuyerID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_buyer_id"})
		return
	}
	sellerID, err := uuid.Parse(req.SellerID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_seller_id"})
		return
	}
	notional, err := parsePositiveInt64(req.Notional)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_notional"})
		return
	}
	buyerFee, err := parseNonNegativeInt64(req.BuyerFee)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_buyer_fee"})
		return
	}
	sellerFee, err := parseNonNegativeInt64(req.SellerFee)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_seller_fee"})
		return
	}
	tx, err := h.svc.SettleReservedTrade(c.Request.Context(), ledger.TradeSettlementParams{BuyerID: buyerID, SellerID: sellerID, Notional: notional, BuyerFee: buyerFee, SellerFee: sellerFee, Reference: req.Reference, IdempotencyKey: req.IdempotencyKey, Metadata: req.Metadata})
	if err != nil {
		c.JSON(mapErrToStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, tx)
}

func parsePositiveInt64(raw string) (int64, error) {
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || v <= 0 {
		return 0, errors.New("must be positive int64")
	}
	return v, nil
}

func parseNonNegativeInt64(raw string) (int64, error) {
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || v < 0 {
		return 0, errors.New("must be non-negative int64")
	}
	return v, nil
}

func (h *handler) settleDeposit(c *gin.Context) {
	var req settleDepositReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	uid, err := uuid.Parse(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_user_id"})
		return
	}
	amount, err := parsePositiveInt64(req.Amount)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount"})
		return
	}
	tx, err := h.svc.SettleDeposit(c.Request.Context(), uid, amount, req.Reference, req.IdempotencyKey, req.Metadata)
	if err != nil {
		c.JSON(mapErrToStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, tx)
}

func (h *handler) credit(c *gin.Context) {
	var req creditReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	uid, _ := uuid.Parse(req.UserID)
	amount, err := parsePositiveInt64(req.Amount)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount"})
		return
	}
	acc, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), uid)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	tx, err := h.svc.Credit(c.Request.Context(), ledger.CreditParams{
		AccountID: acc.ID, Amount: amount, Type: domainTxType(req.Type),
		Reference: req.Reference, Metadata: req.Metadata, Actor: "api",
		IdempotencyKey: req.IdempotencyKey,
	})
	if err != nil {
		c.JSON(mapErrToStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(201, tx)
}

func (h *handler) reserve(c *gin.Context) {
	h.escrow(c, true)
}

func (h *handler) release(c *gin.Context) {
	h.escrow(c, false)
}

func (h *handler) escrow(c *gin.Context, reserve bool) {
	var req escrowReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	uid, err := uuid.Parse(c.Param("user_id"))
	if err != nil || uid.String() != req.UserID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id_mismatch"})
		return
	}
	acc, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	amount, err := parsePositiveInt64(req.Amount)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount"})
		return
	}
	params := ledger.CreditParams{AccountID: acc.ID, Amount: amount, Type: domain.TxReserve, Reference: req.Reference, Metadata: req.Metadata, Actor: "api", IdempotencyKey: req.IdempotencyKey}
	var tx *domain.Transaction
	if reserve {
		tx, err = h.svc.Reserve(c.Request.Context(), params)
	} else {
		params.Type = domain.TxRelease
		tx, err = h.svc.Release(c.Request.Context(), params)
	}
	if err != nil {
		c.JSON(mapErrToStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, tx)
}

func (h *handler) debit(c *gin.Context) {
	var req debitReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	uid, _ := uuid.Parse(req.UserID)
	amount, err := parsePositiveInt64(req.Amount)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount"})
		return
	}
	acc, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), uid)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	tx, err := h.svc.Debit(c.Request.Context(), ledger.DebitParams{
		AccountID: acc.ID, Amount: amount, Type: domainTxType(req.Type),
		Reference: req.Reference, Metadata: req.Metadata, Actor: "api",
		IdempotencyKey: req.IdempotencyKey,
	})
	if err != nil {
		c.JSON(mapErrToStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, tx)
}

func (h *handler) internalKind(raw string) (domain.AccountKind, bool) {
	switch raw {
	case string(domain.AccountReserve):
		return domain.AccountReserve, true
	case string(domain.AccountTreasury):
		return domain.AccountTreasury, true
	default:
		return "", false
	}
}

func (h *handler) creditInternal(c *gin.Context) {
	kind, ok := h.internalKind(c.Param("kind"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_internal_account"})
		return
	}
	var req internalLedgerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	amount, err := parsePositiveInt64(req.Amount)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount"})
		return
	}
	acc, err := h.svc.EnsureInternalAccount(c.Request.Context(), kind)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	tx, err := h.svc.Credit(c.Request.Context(), ledger.CreditParams{
		AccountID: acc.ID, Amount: amount, Type: domainTxType(req.Type), Reference: req.Reference,
		Metadata: req.Metadata, Actor: "internal:" + string(kind), IdempotencyKey: req.IdempotencyKey,
	})
	if err != nil {
		c.JSON(mapErrToStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, tx)
}

func (h *handler) debitInternal(c *gin.Context) {
	kind, ok := h.internalKind(c.Param("kind"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_internal_account"})
		return
	}
	var req internalLedgerReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	amount, err := parsePositiveInt64(req.Amount)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount"})
		return
	}
	acc, err := h.svc.EnsureInternalAccount(c.Request.Context(), kind)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	tx, err := h.svc.Debit(c.Request.Context(), ledger.DebitParams{
		AccountID: acc.ID, Amount: amount, Type: domainTxType(req.Type), Reference: req.Reference,
		Metadata: req.Metadata, Actor: "internal:" + string(kind), IdempotencyKey: req.IdempotencyKey,
	})
	if err != nil {
		c.JSON(mapErrToStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, tx)
}

func (h *handler) transfer(c *gin.Context) {
	var req transferReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	amount, err := parsePositiveInt64(req.Amount)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount"})
		return
	}
	fromUID, _ := uuid.Parse(req.FromUserID)
	toUID, _ := uuid.Parse(req.ToUserID)
	from, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), fromUID)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	to, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), toUID)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.Transfer(c.Request.Context(), from.ID, to.ID, amount, req.Reference, req.Actor, req.IdempotencyKey, req.Metadata); err != nil {
		c.JSON(mapErrToStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"status": "transferred"})
}

func (h *handler) listWithdrawalDestinations(c *gin.Context) {
	uid, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_user_id"})
		return
	}
	acc, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	items, err := h.svc.ListWithdrawalDestinations(c.Request.Context(), acc.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"items": items})
}

func (h *handler) createWithdrawalDestination(c *gin.Context) {
	var req withdrawalDestinationReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	uid, _ := uuid.Parse(req.UserID)
	acc, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	destination, token, err := h.svc.CreateWithdrawalDestination(c.Request.Context(), acc.ID, req.Chain, req.Destination, req.Label, 15*time.Minute)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"destination": destination, "confirmation_token": token})
}

func (h *handler) confirmWithdrawalDestination(c *gin.Context) {
	var req confirmWithdrawalDestinationReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	uid, _ := uuid.Parse(req.UserID)
	acc, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	if err := h.svc.ConfirmWithdrawalDestination(c.Request.Context(), acc.ID, id, req.Token, 24*time.Hour); err != nil {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *handler) revokeWithdrawalDestination(c *gin.Context) {
	uid, err := uuid.Parse(c.Query("user_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_user_id"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	acc, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), uid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if err := h.svc.RevokeWithdrawalDestination(c.Request.Context(), acc.ID, id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *handler) withdraw(c *gin.Context) {
	var req withdrawReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	uid, _ := uuid.Parse(req.UserID)
	acc, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), uid)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	amount, err := parsePositiveInt64(req.Amount)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_amount"})
		return
	}
	wdSvc := ledger.NewWithdrawalService(h.svc, h.svc.Custody(), 2) // 2-of-3 until policy is configurable
	wd, err := wdSvc.Request(c.Request.Context(), acc.ID, amount, req.Chain, req.Destination, req.IdempotencyKey)
	if err != nil {
		c.JSON(mapErrToStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(201, wd)
}

func (h *handler) signWithdrawal(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid_id"})
		return
	}
	signerID := c.GetHeader("X-Signer-Id")
	if signerID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "signer_identity_required"})
		return
	}
	wdSvc := ledger.NewWithdrawalService(h.svc, h.svc.Custody(), 2)
	wd, err := wdSvc.Sign(c.Request.Context(), id, signerID)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, wd)
}

func (h *handler) cancelWithdrawal(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_id"})
		return
	}
	wdSvc := ledger.NewWithdrawalService(h.svc, h.svc.Custody(), 2)
	wd, err := wdSvc.Cancel(c.Request.Context(), id, "internal recovery request")
	if err != nil {
		c.JSON(mapErrToStatus(err), gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, wd)
}

func (h *handler) listTransactions(c *gin.Context) {
	uid, err := uuid.Parse(c.Param("user_id"))
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid_user_id"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	acc, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), uid)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	txs, err := h.svc.ListTransactions(c.Request.Context(), acc.ID, limit, offset)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	c.JSON(200, gin.H{"items": txs, "limit": limit, "offset": offset})
}

func mapErrToStatus(err error) int {
	switch err {
	case ledger.ErrInsufficient:
		return 422
	case ledger.ErrAccountNotFound:
		return 404
	case ledger.ErrIdempotencyClash:
		return 409
	case ledger.ErrNegativeAmount:
		return 400
	case ledger.ErrVersionConflict:
		return 409
	case ledger.ErrWithdrawalsPaused:
		return 423
	case ledger.ErrDestinationNotWhitelisted:
		return 403
	default:
		return 500
	}
}

func domainTxType(s string) domain.TransactionType {
	// Validation is performed at the HTTP boundary before this conversion.
	return domain.TransactionType(s)
}
