package custody

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"sync"

)

// MemorySigner is an in-memory ECDSA signer; suitable for development & tests only.
type MemorySigner struct {
	mu   sync.RWMutex
	keys map[string]*ecdsa.PrivateKey
}

func New(_ interface{}) Signer {
	s := &MemorySigner{keys: make(map[string]*ecdsa.PrivateKey)}
	// pre-create 3 default signer keys (1-of-3, 2-of-3, 3-of-5 schemes supported via config)
	for _, id := range []string{"node-1", "node-2", "node-3"} {
		k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err == nil { s.keys[id] = k }
	}
	return s
}

func (m *MemorySigner) Sign(_ context.Context, keyID string, digest []byte) ([]byte, error) {
	m.mu.RLock()
	k, ok := m.keys[keyID]
	m.mu.RUnlock()
	if !ok { return nil, errors.New("unknown key: " + keyID) }
	// ensure 32-byte digest (hash if needed)
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
	if !ok { return nil, errors.New("unknown key: " + keyID) }
	pub := elliptic.MarshalCompressed(elliptic.P256(), k.PublicKey.X, k.PublicKey.Y)
	return pub, nil
}
