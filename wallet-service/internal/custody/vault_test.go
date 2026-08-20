package custody

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
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

func TestVaultTransitSignerPubKeyUsesHighestNumericVersion(t *testing.T) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	der, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatalf("marshal public key: %v", err)
	}
	pemKey := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != "/v1/transit/keys/trade-key" {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"keys":{"9":{"public_key":"` + strings.ReplaceAll(string(pemKey), "\n", "\\n") + `"},"10":{"public_key":"` + strings.ReplaceAll(string(pemKey), "\n", "\\n") + `"}}}}`))
	}))
	defer srv.Close()

	signer := &VaultTransitSigner{baseURL: srv.URL, token: "test-token", client: srv.Client()}
	got, err := signer.PubKey(context.Background(), "trade-key")
	if err != nil {
		t.Fatalf("pubkey failed: %v", err)
	}
	want := elliptic.MarshalCompressed(elliptic.P256(), key.PublicKey.X, key.PublicKey.Y)
	if string(got) != string(want) {
		t.Fatalf("public key mismatch")
	}
}
