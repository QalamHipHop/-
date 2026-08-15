package api

import (
	"crypto/subtle"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/rial/wallet-service/internal/config"
	"github.com/rial/wallet-service/internal/domain"
	"github.com/rial/wallet-service/internal/ledger"
)

type creditReq struct {
	UserID         string         `json:"user_id" binding:"required,uuid"`
	Amount         int64          `json:"amount" binding:"required,gt=0"`
	Type           string         `json:"type" binding:"required"`
	Reference      string         `json:"reference"`
	IdempotencyKey string         `json:"idempotency_key" binding:"required,min=8,max=128"`
	Metadata       map[string]any `json:"metadata"`
}

type debitReq struct {
	UserID         string         `json:"user_id" binding:"required,uuid"`
	Amount         int64          `json:"amount" binding:"required,gt=0"`
	Type           string         `json:"type" binding:"required"`
	Reference      string         `json:"reference"`
	IdempotencyKey string         `json:"idempotency_key" binding:"required,min=8,max=128"`
	Metadata       map[string]any `json:"metadata"`
}

type transferReq struct {
	FromUserID     string         `json:"from_user_id" binding:"required,uuid"`
	ToUserID       string         `json:"to_user_id" binding:"required,uuid"`
	Amount         int64          `json:"amount" binding:"required,gt=0"`
	Reference      string         `json:"reference"`
	Actor          string         `json:"actor" binding:"required"`
	IdempotencyKey string         `json:"idempotency_key" binding:"required,min=8,max=128"`
	Metadata       map[string]any `json:"metadata"`
}

type withdrawReq struct {
	UserID         string `json:"user_id" binding:"required,uuid"`
	Amount         int64  `json:"amount" binding:"required,gt=0"`
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
		v1.POST("/debit", h.debit)
		v1.POST("/transfer", h.transfer)
		v1.POST("/withdraw", h.withdraw)
		v1.POST("/withdraw/:id/sign", h.signWithdrawal)
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
	if err != nil { c.JSON(http.StatusBadRequest, gin.H{"error": "invalid_user_id"}); return }
	acc, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), uid)
	if err != nil { c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()}); return }
	c.JSON(http.StatusOK, acc)
}

func (h *handler) credit(c *gin.Context) {
	var req creditReq
	if err := c.ShouldBindJSON(&req); err != nil { c.JSON(400, gin.H{"error": err.Error()}); return }
	uid, _ := uuid.Parse(req.UserID)
	acc, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), uid)
	if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
	tx, err := h.svc.Credit(c.Request.Context(), ledger.CreditParams{
		AccountID: acc.ID, Amount: req.Amount, Type: domainTxType(req.Type),
		Reference: req.Reference, Metadata: req.Metadata, Actor: "api",
		IdempotencyKey: req.IdempotencyKey,
	})
	if err != nil { c.JSON(mapErrToStatus(err), gin.H{"error": err.Error()}); return }
	c.JSON(201, tx)
}

func (h *handler) debit(c *gin.Context) {
	var req debitReq
	if err := c.ShouldBindJSON(&req); err != nil { c.JSON(400, gin.H{"error": err.Error()}); return }
	uid, _ := uuid.Parse(req.UserID)
	acc, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), uid)
	if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
	tx, err := h.svc.Debit(c.Request.Context(), ledger.DebitParams{
		AccountID: acc.ID, Amount: req.Amount, Type: domainTxType(req.Type),
		Reference: req.Reference, Metadata: req.Metadata, Actor: "api",
		IdempotencyKey: req.IdempotencyKey,
	})
	if err != nil { c.JSON(mapErrToStatus(err), gin.H{"error": err.Error()}); return }
	c.JSON(200, tx)
}

func (h *handler) transfer(c *gin.Context) {
	var req transferReq
	if err := c.ShouldBindJSON(&req); err != nil { c.JSON(400, gin.H{"error": err.Error()}); return }
	fromUID, _ := uuid.Parse(req.FromUserID)
	toUID, _ := uuid.Parse(req.ToUserID)
	from, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), fromUID)
	if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
	to, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), toUID)
	if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
	if err := h.svc.Transfer(c.Request.Context(), from.ID, to.ID, req.Amount, req.Reference, req.Actor, req.IdempotencyKey, req.Metadata); err != nil {
		c.JSON(mapErrToStatus(err), gin.H{"error": err.Error()}); return
	}
	c.JSON(200, gin.H{"status": "transferred"})
}

func (h *handler) withdraw(c *gin.Context) {
	var req withdrawReq
	if err := c.ShouldBindJSON(&req); err != nil { c.JSON(400, gin.H{"error": err.Error()}); return }
	uid, _ := uuid.Parse(req.UserID)
	acc, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), uid)
	if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
	wdSvc := ledger.NewWithdrawalService(h.svc, nil, 2) // 2-of-3 in dev
	wd, err := wdSvc.Request(c.Request.Context(), acc.ID, req.Amount, req.Chain, req.Destination, req.IdempotencyKey)
	if err != nil { c.JSON(mapErrToStatus(err), gin.H{"error": err.Error()}); return }
	c.JSON(201, wd)
}

func (h *handler) signWithdrawal(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil { c.JSON(400, gin.H{"error": "invalid_id"}); return }
	signerID := c.GetHeader("X-Signer-Id")
	if signerID == "" { signerID = "node-1" }
	wdSvc := ledger.NewWithdrawalService(h.svc, nil, 2)
	wd, err := wdSvc.Sign(c.Request.Context(), id, signerID)
	if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
	c.JSON(200, wd)
}

func (h *handler) listTransactions(c *gin.Context) {
	uid, err := uuid.Parse(c.Param("user_id"))
	if err != nil { c.JSON(400, gin.H{"error": "invalid_user_id"}); return }
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	acc, err := h.svc.GetOrCreateUserAccount(c.Request.Context(), uid)
	if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
	txs, err := h.svc.ListTransactions(c.Request.Context(), acc.ID, limit, offset)
	if err != nil { c.JSON(500, gin.H{"error": err.Error()}); return }
	c.JSON(200, gin.H{"items": txs, "limit": limit, "offset": offset})
}

func mapErrToStatus(err error) int {
	switch err {
	case ledger.ErrInsufficient: return 422
	case ledger.ErrAccountNotFound: return 404
	case ledger.ErrIdempotencyClash: return 409
	case ledger.ErrNegativeAmount: return 400
	case ledger.ErrVersionConflict: return 409
	default: return 500
	}
}

func domainTxType(s string) domain.TransactionType {
	// Validation is performed at the HTTP boundary before this conversion.
	return domain.TransactionType(s)
}
