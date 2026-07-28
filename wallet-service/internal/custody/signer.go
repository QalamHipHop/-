// Package custody provides a pluggable signing interface.
//
// In-memory signer is for development. Production must use:
//   - HashiCorp Vault Transit (preferred for on-prem / hybrid)
//   - AWS KMS / GCP KMS / Azure Key Vault for cloud
//   - HSM (YubiHSM, AWS CloudHSM) for the highest assurance
package custody

import "context"

type Signer interface {
	// Sign produces a signature for the given digest using the key identified by `keyID`.
	Sign(ctx context.Context, keyID string, digest []byte) ([]byte, error)
	// PubKey returns the public key bytes for the given keyID.
	PubKey(ctx context.Context, keyID string) ([]byte, error)
}
