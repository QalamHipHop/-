package custody

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// VaultTransitSigner delegates private-key operations to HashiCorp Vault Transit.
// Private key material never enters the wallet process.
type VaultTransitSigner struct {
	baseURL string
	token   string
	client  *http.Client
}

func NewVault(addr, token string) (Signer, error) {
	addr = strings.TrimRight(strings.TrimSpace(addr), "/")
	if addr == "" || token == "" {
		return nil, errors.New("vault address and token are required")
	}
	if !strings.HasPrefix(addr, "https://") {
		return nil, errors.New("vault address must use https")
	}
	return &VaultTransitSigner{baseURL: addr, token: token, client: &http.Client{Timeout: 10 * time.Second}}, nil
}

func (v *VaultTransitSigner) Sign(ctx context.Context, keyID string, digest []byte) ([]byte, error) {
	if len(digest) != sha256.Size {
		h := sha256.Sum256(digest)
		digest = h[:]
	}
	var response struct {
		Data struct {
			Signature string `json:"signature"`
		} `json:"data"`
	}
	if err := v.request(ctx, http.MethodPost, "/v1/transit/sign/"+keyID+"/sha2-256", map[string]any{
		"input":                base64.StdEncoding.EncodeToString(digest),
		"marshaling_algorithm": "asn1",
	}, &response); err != nil {
		return nil, err
	}
	parts := strings.Split(response.Data.Signature, ":")
	if len(parts) < 3 || parts[len(parts)-1] == "" {
		return nil, errors.New("vault returned invalid transit signature")
	}
	out, err := base64.StdEncoding.DecodeString(parts[len(parts)-1])
	if err != nil {
		return nil, fmt.Errorf("decode vault signature: %w", err)
	}
	return out, nil
}

func (v *VaultTransitSigner) PubKey(ctx context.Context, keyID string) ([]byte, error) {
	var response struct {
		Data struct {
			Keys map[string]struct {
				PublicKey string `json:"public_key"`
			} `json:"keys"`
		} `json:"data"`
	}
	if err := v.request(ctx, http.MethodGet, "/v1/transit/keys/"+keyID, nil, &response); err != nil {
		return nil, err
	}
	if len(response.Data.Keys) == 0 {
		return nil, errors.New("vault transit key has no versions")
	}
	var latest string
	var latestVersion int
	for version := range response.Data.Keys {
		parsedVersion, err := strconv.Atoi(version)
		if err != nil || parsedVersion < 1 {
			continue
		}
		if latest == "" || parsedVersion > latestVersion {
			latest = version
			latestVersion = parsedVersion
		}
	}
	encoded := response.Data.Keys[latest].PublicKey
	if encoded == "" {
		return nil, errors.New("vault transit public key missing")
	}
	block, _ := pem.Decode([]byte(encoded))
	if block == nil {
		return nil, errors.New("vault transit public key is not PEM encoded")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse vault public key: %w", err)
	}
	pub, ok := parsed.(*ecdsa.PublicKey)
	if !ok || pub.Curve != elliptic.P256() {
		return nil, errors.New("vault transit public key is not an ECDSA P-256 key")
	}
	return elliptic.MarshalCompressed(elliptic.P256(), pub.X, pub.Y), nil
}

func (v *VaultTransitSigner) request(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, v.baseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("X-Vault-Token", v.token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := v.client.Do(req)
	if err != nil {
		return fmt.Errorf("vault request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("vault request failed status=%d body=%s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode vault response: %w", err)
	}
	return nil
}
