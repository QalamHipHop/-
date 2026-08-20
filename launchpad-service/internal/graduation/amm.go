package graduation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

type PoolRequest struct {
	TokenID          uuid.UUID `json:"token_id"`
	Base             string    `json:"base"`
	ReserveRialMinor int64     `json:"reserve_rial_minor"`
	SupplyMinor      int64     `json:"supply_minor"`
	IdempotencyKey   string    `json:"idempotency_key"`
}

type PoolResult struct {
	PoolAddress string `json:"pool_address"`
	TxHash      string `json:"tx_hash"`
}

type AMMAdapter interface {
	CreatePool(context.Context, PoolRequest) (PoolResult, error)
}

// HTTPAdapter is intentionally strict: an empty endpoint is unavailable and
// never treated as a successful dry-run. The remote adapter must itself be
// idempotent on idempotency_key and return durable pool/transaction evidence.
type HTTPAdapter struct {
	endpoint string
	token    string
	client   *http.Client
}

func NewHTTPAdapter(endpoint, token string) *HTTPAdapter {
	return &HTTPAdapter{endpoint: strings.TrimRight(endpoint, "/"), token: token, client: &http.Client{Timeout: 10 * time.Second}}
}

func (a *HTTPAdapter) CreatePool(ctx context.Context, req PoolRequest) (PoolResult, error) {
	if a.endpoint == "" {
		return PoolResult{}, errors.New("AMM_ENDPOINT_UNCONFIGURED")
	}
	body, err := json.Marshal(req)
	if err != nil {
		return PoolResult{}, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, a.endpoint+"/v1/pools", bytes.NewReader(body))
	if err != nil {
		return PoolResult{}, err
	}
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Idempotency-Key", req.IdempotencyKey)
	if a.token != "" {
		httpReq.Header.Set("X-Rial-Internal-Token", a.token)
	}
	resp, err := a.client.Do(httpReq)
	if err != nil {
		return PoolResult{}, fmt.Errorf("AMM_UNAVAILABLE: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return PoolResult{}, fmt.Errorf("AMM_REJECTED_STATUS_%d", resp.StatusCode)
	}
	var result PoolResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return PoolResult{}, fmt.Errorf("AMM_INVALID_RESPONSE: %w", err)
	}
	if result.PoolAddress == "" || result.TxHash == "" {
		return PoolResult{}, errors.New("AMM_EVIDENCE_MISSING")
	}
	return result, nil
}
