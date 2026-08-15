package wallet

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/rial/launchpad-service/internal/config"
)

type Client struct {
	baseURL string
	http    *http.Client
}

type ledgerRequest struct {
	UserID         string         `json:"user_id"`
	Amount         int64          `json:"amount"`
	Type           string         `json:"type"`
	Reference      string         `json:"reference"`
	IdempotencyKey string         `json:"idempotency_key"`
	Metadata       map[string]any `json:"metadata"`
}

type ledgerResponse struct {
	ID string `json:"id"`
}

func NewClient(cfg config.Wallet) *Client {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	return &Client{
		baseURL: strings.TrimRight(cfg.BaseURL, "/"),
		http:    &http.Client{Timeout: timeout},
	}
}

func (c *Client) Debit(ctx context.Context, userID string, amount int64, reference, idempotencyKey string, metadata map[string]any) (string, error) {
	return c.post(ctx, "/v1/debit", ledgerRequest{
		UserID: userID, Amount: amount, Type: "trade", Reference: reference,
		IdempotencyKey: idempotencyKey, Metadata: metadata,
	})
}

func (c *Client) CreditTrade(ctx context.Context, userID string, amount int64, reference, idempotencyKey string, metadata map[string]any) (string, error) {
	return c.credit(ctx, userID, amount, "trade", reference, idempotencyKey, metadata)
}

func (c *Client) Refund(ctx context.Context, userID string, amount int64, reference, idempotencyKey string, metadata map[string]any) (string, error) {
	return c.credit(ctx, userID, amount, "refund", reference, idempotencyKey, metadata)
}

func (c *Client) credit(ctx context.Context, userID string, amount int64, transactionType, reference, idempotencyKey string, metadata map[string]any) (string, error) {
	return c.post(ctx, "/v1/credit", ledgerRequest{
		UserID: userID, Amount: amount, Type: transactionType, Reference: reference,
		IdempotencyKey: idempotencyKey, Metadata: metadata,
	})
}

func (c *Client) post(ctx context.Context, path string, payload ledgerRequest) (string, error) {
	if c.baseURL == "" {
		return "", fmt.Errorf("wallet settlement URL is not configured")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal wallet request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create wallet request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("wallet request: %w", err)
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return "", fmt.Errorf("read wallet response: %w", err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("wallet settlement rejected (%d): %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	var out ledgerResponse
	if err := json.Unmarshal(responseBody, &out); err != nil {
		return "", fmt.Errorf("decode wallet response: %w", err)
	}
	if out.ID == "" {
		return "", fmt.Errorf("wallet settlement response missing transaction id")
	}
	return out.ID, nil
}
