// Package risk — thin HTTP client to the AI engine (fraud/risk scoring).
package risk

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

type Client struct {
	base string
	http *http.Client
	log  *zap.Logger
}

type TokenInput struct {
	Name        string `json:"name"`
	Symbol      string `json:"symbol"`
	Description string `json:"description"`
	Website     string `json:"website"`
	Telegram    string `json:"telegram"`
	Twitter     string `json:"twitter"`
	LogoURL     string `json:"logo_url"`
}

type RiskScore struct {
	Score      float64                `json:"score"`
	Components map[string]float64     `json:"components"`
	Raw        map[string]interface{} `json:"raw,omitempty"`
}

func NewClient(base string, log *zap.Logger) *Client {
	return &Client{base: base, http: &http.Client{Timeout: 5 * time.Second}, log: log}
}

func (c *Client) ScoreToken(ctx context.Context, in TokenInput) (*RiskScore, error) {
	body, _ := json.Marshal(in)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/v1/risk/token", bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil { return nil, err }
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 200 { return nil, &httpErr{status: resp.StatusCode, body: readAll(resp.Body)} }
	var out RiskScore
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil { return nil, err }
	return &out, nil
}

func (c *Client) ScoreUser(ctx context.Context, userID string) (*RiskScore, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, c.base+"/v1/risk/user/"+userID, nil)
	resp, err := c.http.Do(req)
	if err != nil { return nil, err }
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == 404 { return &RiskScore{Score: 0, Components: map[string]float64{}}, nil }
	if resp.StatusCode != 200 { return nil, &httpErr{status: resp.StatusCode, body: readAll(resp.Body)} }
	var out RiskScore
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil { return nil, err }
	return &out, nil
}

func (c *Client) ScoreOrder(ctx context.Context, userID uuid.UUID, market string, side string, amountMinor int64) (*RiskScore, error) {
	body, _ := json.Marshal(map[string]interface{}{"user_id": userID.String(), "market": market, "side": side, "amount_minor": amountMinor})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, c.base+"/v1/risk/order", bytes.NewReader(body))
	req.Header.Set("content-type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil { return nil, err }
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != 200 { return nil, &httpErr{status: resp.StatusCode, body: readAll(resp.Body)} }
	var out RiskScore
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil { return nil, err }
	return &out, nil
}

type httpErr struct{ status int; body string }
func (e *httpErr) Error() string { return e.body }

func readAll(r io.Reader) string { b, _ := io.ReadAll(r); return string(b) }
