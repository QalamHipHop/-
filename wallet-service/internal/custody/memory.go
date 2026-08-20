// Author: QalamHipHop
// Package custody contains signing implementations for the wallet service.
package custody

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"sync"
)

// MemorySigner is an in-memory ECDSA signer. It is intended only for local
// development and tests; production must use a durable KMS/Vault/HSM adapter.
type MemorySigner struct {
	mu   sync.RWMutex
	keys map[string]*ecdsa.PrivateKey
}

// New creates a signer only for an explicitly supported non-production mode.
// Keeping this factory fail-closed prevents configuration from silently
// selecting an ephemeral signer for a production deployment.
func New(mode string) (Signer, error) {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode == "" || mode == "memory" || mode == "dev" || mode == "development" || mode == "test" {
		return NewMemory(), nil
	}
	return nil, fmt.Errorf("custody mode %q is not implemented; refusing to start", mode)
}

func NewMemory() Signer {
	s := &MemorySigner{keys: make(map[string]*ecdsa.PrivateKey)}
	for _, id := range []string{"node-1", "node-2", "node-3"} {
		k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			continue
		}
		s.keys[id] = k
	}
	return s
}

func (m *MemorySigner) Sign(_ context.Context, keyID string, digest []byte) ([]byte, error) {
	m.mu.RLock()
	k, ok := m.keys[keyID]
	m.mu.RUnlock()
	if !ok {
		return nil, errors.New("unknown key: " + keyID)
	}
	if len(digest) != 32 {
		h := sha256.Sum256(digest)
		digest = h[:]
	}
	return ecdsa.SignASN1(rand.Reader, k, digest)
}

func (m *MemorySigner) PubKey(_ context.Context, keyID string) ([]byte, error) {
	m.mu.RLock()
	k, ok := m.keys[keyID]
	m.mu.RUnlock()
	if !ok {
		return nil, errors.New("unknown key: " + keyID)
	}
	return elliptic.MarshalCompressed(elliptic.P256(), k.PublicKey.X, k.PublicKey.Y), nil
}
