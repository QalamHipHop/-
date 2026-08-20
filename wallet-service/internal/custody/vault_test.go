package custody

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNewVaultRequiresHTTPS(t *testing.T) {
	if _, err := NewVault("http://vault", "token"); err == nil {
		t.Fatal("expected HTTPS validation")
	}
}

func TestVaultTransitSignerSign(t *testing.T) {
	digest := sha256.Sum256([]byte("rial"))
	expected := []byte("signature-bytes")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/transit/sign/trade-key/sha2-256" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("X-Vault-Token") != "test-token" {
			t.Fatalf("missing vault token")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"signature":"vault:v1:` + base64.StdEncoding.EncodeToString(expected) + `"}}`))
	}))
	defer srv.Close()

	signer := &VaultTransitSigner{baseURL: srv.URL, token: "test-token", client: srv.Client()}
	got, err := signer.Sign(context.Background(), "trade-key", digest[:])
	if err != nil {
		t.Fatalf("sign failed: %v", err)
	}
	if string(got) != string(expected) {
		t.Fatalf("signature mismatch: got %q want %q", got, expected)
	}
}
